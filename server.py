import os
import asyncio
import secrets
import hashlib
import hmac
import time
import random
import json
import struct
import math
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, Header, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from jose import jwt, JWTError
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

APP_DIR = os.path.dirname(os.path.abspath(__file__))
SECRET_KEY = os.getenv("SECRET_KEY", "local-development-only-change-me")
ALGORITHM = "HS256"
MONGO_URI = os.getenv("MONGO_URI", "")
CESIUM_ION_TOKEN = os.getenv("CESIUM_ION_TOKEN", "")
CESIUM_ION_ADMIN_TOKEN = os.getenv("CESIUM_ION_ADMIN_TOKEN", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")

app = FastAPI(title="World Game API", version="1.0.0")
app.mount("/static", StaticFiles(directory=os.path.join(APP_DIR, "static")), name="static")
mongo_client = None
db = None
online_sockets: dict[str, WebSocket] = {}
socket_users: dict[str, dict] = {}
socket_lock = asyncio.Lock()
ai_task = None

class AuthPayload(BaseModel):
    username: str = Field(min_length=3, max_length=24, pattern=r"^[A-Za-z0-9_]+$")
    password: str = Field(min_length=8, max_length=128)

class CountryPayload(BaseModel):
    country_code: str = Field(min_length=2, max_length=3)
    spawn_lat: float = Field(ge=-90, le=90)
    spawn_lon: float = Field(ge=-180, le=180)

class PositionPayload(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    alt: float = Field(default=0, ge=0, le=100000)
    mode: str = Field(default="human", pattern="^(human|aircraft)$")
    aircraft: str = Field(default="human", max_length=80)
    heading: float = Field(default=0, ge=0, le=360)
    pitch: float = Field(default=0, ge=-90, le=90)
    roll: float = Field(default=0, ge=-180, le=180)

class InvitePayload(BaseModel):
    target: str = Field(min_length=3, max_length=24)
    message: str = Field(default="Приглашаю тебя в мою страну!", max_length=300)

def password_hash(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000).hex()
    return salt, hashed

def password_ok(password: str, salt: str, expected: str) -> bool:
    return hmac.compare_digest(password_hash(password, salt)[1], expected)

def token_for(user: dict) -> str:
    now = int(time.time())
    return jwt.encode({"sub": str(user["_id"]), "username": user["username"], "iat": now, "exp": now + 60 * 60 * 24 * 30}, SECRET_KEY, algorithm=ALGORITHM)

async def current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if db is None:
        raise HTTPException(503, "MongoDB не настроена: добавьте MONGO_URI в Render")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Требуется вход")
    try:
        payload = jwt.decode(authorization.split(" ", 1)[1], SECRET_KEY, algorithms=[ALGORITHM])
        user = await db.users.find_one({"_id": payload["sub"]})
    except (JWTError, KeyError, ValueError):
        user = None
    if not user:
        raise HTTPException(401, "Сессия истекла. Войдите снова.")
    return user

async def broadcast(payload: dict, skip: Optional[str] = None):
    stale = []
    async with socket_lock:
        peers = list(online_sockets.items())
    for uid, ws in peers:
        if uid == skip:
            continue
        try:
            await ws.send_json(payload)
        except Exception:
            stale.append(uid)
    for uid in stale:
        online_sockets.pop(uid, None)
        socket_users.pop(uid, None)

@app.on_event("startup")
async def startup():
    global mongo_client, db, ai_task
    if MONGO_URI:
        mongo_client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=8000)
        try:
            db = mongo_client.get_default_database()
        except Exception:
            db = mongo_client["world_game"]
        try:
            await mongo_client.admin.command("ping")
            await db.users.create_index("username_lower", unique=True)
            await db.countries.create_index("country_code", unique=True)
            await db.players.create_index("user_id", unique=True)
            await db.ai_countries.create_index("country_code", unique=True)
            ai_seed = [
                ("JP", "Япония", 36.2, 138.2), ("AU", "Австралия", -25.3, 133.8),
                ("BR", "Бразилия", -10.8, -52.9), ("NO", "Норвегия", 60.5, 8.5),
                ("EG", "Египет", 26.8, 30.8), ("IN", "Индия", 21.1, 78.0),
                ("CA", "Канада", 56.1, -106.3), ("ZA", "ЮАР", -30.6, 22.9),
                ("NZ", "Новая Зеландия", -40.9, 174.9), ("AR", "Аргентина", -38.4, -63.6)
            ]
            for code, name, lat, lon in ai_seed:
                await db.ai_countries.update_one({"country_code": code}, {"$setOnInsert": {
                    "country_code": code, "name": name, "username": "AI · " + name,
                    "position": {"lat": lat, "lon": lon, "alt": 9000, "heading": 45},
                    "mode": "aircraft", "aircraft": "airbus-a320", "online": True,
                    "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
            ai_task = asyncio.create_task(ai_flight_loop())
        except Exception as exc:
            print("MongoDB connection/index setup warning:", exc)
    else:
        print("MONGO_URI is not set; auth and persistent game state are unavailable.")

async def ai_flight_loop():
    """Move AI aircraft and periodically announce simulated flights."""
    while True:
        try:
            if db is not None:
                async for ai in db.ai_countries.find({"online": True}):
                    pos = ai.get("position", {})
                    lat = max(-80, min(80, float(pos.get("lat", 0)) + random.uniform(-0.3, 0.3)))
                    lon = ((float(pos.get("lon", 0)) + random.uniform(-0.5, 0.5) + 180) % 360) - 180
                    heading = (float(pos.get("heading", 45)) + random.uniform(-12, 12)) % 360
                    new_pos = {"lat": lat, "lon": lon, "alt": random.randint(6500, 11000), "heading": heading}
                    await db.ai_countries.update_one({"_id": ai["_id"]}, {"$set": {"position": new_pos, "updated_at": datetime.now(timezone.utc).isoformat()}})
                    if random.random() < 0.12:
                        await broadcast({"type": "chat", "from": ai.get("username", "AI country"),
                            "message": "Сообщаем о выполнении виртуального рейса над координатами %.1f°, %.1f°." % (lat, lon)})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print("AI flight loop warning:", exc)
        await asyncio.sleep(20)

@app.on_event("shutdown")
async def shutdown():
    global ai_task
    if ai_task:
        ai_task.cancel()
    if mongo_client:
        mongo_client.close()

@app.get("/")
async def home():
    return FileResponse(os.path.join(APP_DIR, "static", "index.html"))

@app.get("/api/health")
async def health():
    mongo_ok = False
    if db is not None:
        try:
            await mongo_client.admin.command("ping")
            mongo_ok = True
        except Exception:
            pass
    return {"ok": True, "service": "world-game", "mongodb": mongo_ok, "time": datetime.now(timezone.utc).isoformat()}

@app.get("/api/config")
async def public_config():
    return {"cesiumToken": CESIUM_ION_TOKEN, "cesiumConfigured": bool(CESIUM_ION_TOKEN), "cesiumTokenProvisioning": bool(CESIUM_ION_ADMIN_TOKEN), "openWeatherConfigured": bool(OPENWEATHER_API_KEY), "voiceEnabled": True}

@app.post("/api/auth/register")
async def register(payload: AuthPayload):
    if db is None:
        raise HTTPException(503, "MongoDB не настроена. Добавьте MONGO_URI в Render.")
    username = payload.username.strip()
    lower = username.lower()
    if await db.users.find_one({"username_lower": lower}):
        raise HTTPException(409, "Это имя уже занято.")
    salt, hashed = password_hash(payload.password)
    user = {"_id": secrets.token_hex(16), "username": username, "username_lower": lower,
            "salt": salt, "password_hash": hashed, "country_code": None, "spawn": None,
            "created_at": datetime.now(timezone.utc).isoformat(), "mode": "human",
            "aircraft": "human", "position": {"lat": 20.0, "lon": 0.0, "alt": 0, "heading": 0}}
    try:
        await db.users.insert_one(user)
    except Exception:
        raise HTTPException(409, "Это имя уже занято.")
    return {"token": token_for(user), "user": public_user(user), "needsCountry": True}

@app.post("/api/auth/login")
async def login(payload: AuthPayload):
    if db is None:
        raise HTTPException(503, "MongoDB не настроена. Добавьте MONGO_URI в Render.")
    user = await db.users.find_one({"username_lower": payload.username.strip().lower()})
    if not user or not password_ok(payload.password, user["salt"], user["password_hash"]):
        raise HTTPException(401, "Неверное имя пользователя или пароль.")
    return {"token": token_for(user), "user": public_user(user), "needsCountry": not bool(user.get("country_code"))}

def public_user(user: dict) -> dict:
    return {"id": user["_id"], "username": user["username"], "country_code": user.get("country_code"),
            "spawn": user.get("spawn"), "position": user.get("position"), "mode": user.get("mode", "human"),
            "aircraft": user.get("aircraft", "human")}

@app.get("/api/auth/me")
async def me(user=Depends(current_user)):
    return {"user": public_user(user), "needsCountry": not bool(user.get("country_code"))}

@app.post("/api/auth/logout")
async def logout(user=Depends(current_user)):
    return {"ok": True}

@app.get("/api/countries")
async def countries():
    if db is None:
        raise HTTPException(503, "MongoDB не настроена.")
    taken = await db.countries.find({}, {"_id": 0}).to_list(length=300)
    ai = await db.ai_countries.find({}, {"_id": 0}).to_list(length=300)
    return {"taken": taken, "ai": ai}

@app.post("/api/countries/claim")
async def claim_country(payload: CountryPayload, user=Depends(current_user)):
    if db is None:
        raise HTTPException(503, "MongoDB не настроена.")
    code = payload.country_code.upper()
    if user.get("country_code") and user["country_code"] != code:
        raise HTTPException(409, "У вас уже есть страна. Сначала освободите её в настройках.")
    ai = await db.ai_countries.find_one({"country_code": code})
    if ai:
        raise HTTPException(409, "Эта страна управляется ИИ.")
    existing = await db.countries.find_one({"country_code": code})
    if existing and existing.get("user_id") != user["_id"]:
        raise HTTPException(409, "Эта страна уже занята.")
    doc = {"country_code": code, "user_id": user["_id"], "username": user["username"],
           "spawn": {"lat": payload.spawn_lat, "lon": payload.spawn_lon},
           "claimed_at": datetime.now(timezone.utc).isoformat()}
    await db.countries.update_one({"country_code": code}, {"$set": doc}, upsert=True)
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"country_code": code, "spawn": doc["spawn"],
        "position": {"lat": payload.spawn_lat, "lon": payload.spawn_lon, "alt": 0, "heading": 0}}})
    return {"ok": True, "country": doc}

@app.post("/api/countries/release")
async def release_country(user=Depends(current_user)):
    if user.get("country_code") and db is not None:
        await db.countries.delete_one({"country_code": user["country_code"], "user_id": user["_id"]})
        await db.users.update_one({"_id": user["_id"]}, {"$set": {"country_code": None, "spawn": None}})
    return {"ok": True}


road_response_cache = {}

@app.get("/api/roads")
async def road_network(lat: float, lon: float, radius: int = 1200):
    """Return nearby OSM roads with multiple Overpass fallbacks and stale-cache support."""
    lat = max(-85.0, min(85.0, lat))
    lon = max(-180.0, min(180.0, lon))
    radius = max(500, min(4500, int(radius)))
    cache_key = (round(lat, 3), round(lon, 3), int(radius / 250))
    now = time.monotonic()
    cached = road_response_cache.get(cache_key)
    if cached and cached["data"].get("count", 0) > 0 and now - cached["time"] < 900:
        return cached["data"]

    # Use the OpenStreetMap road-data query service first; cache every successful result.
    # Ask for all mapped highway classes first; rural roads and local streets
    # are not consistently tagged with the narrower list used by older versions.
    query = (
        f'[out:json][timeout:25];'
        f'way(around:{radius},{lat:.6f},{lon:.6f})'
        f'[highway][highway!~"^(footway|path|steps|pedestrian|cycleway|bridleway|corridor|elevator|proposed|construction)$"];'
        f'out tags geom;'
    )
    endpoints = [
        ("https://overpass.private.coffee/api/interpreter", "OpenStreetMap", False),
        ("https://lz4.overpass-api.de/api/interpreter", "OpenStreetMap", False),
        ("https://overpass-api.de/api/interpreter", "OpenStreetMap", False),
        ("https://overpass.kumi.systems/api/interpreter", "OpenStreetMap", False),
        ("https://overpass.nchc.org.tw/api/interpreter", "OpenStreetMap", False),
    ]
    errors = []
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(12.0, connect=4.0),
        follow_redirects=True,
        headers={"User-Agent": "WorldGame/1.0 (road traffic; OpenStreetMap data)"}
    ) as client:
        for endpoint, source_name, _unused in endpoints:
            try:
                response = await client.post(endpoint, data={"data": query}, timeout=httpx.Timeout(12.0, connect=4.0))
                response.raise_for_status()
                payload = response.json()
                ways = []
                for way in payload.get("elements", []):
                    geometry = way.get("geometry") or []
                    if len(geometry) >= 2:
                        points = [{"lat": p["lat"], "lon": p["lon"]}
                                  for p in geometry if "lat" in p and "lon" in p]
                        if len(points) >= 2:
                            ways.append({"id": way.get("id"), "tags": way.get("tags", {}),
                                         "geometry": points})
                result = {"ways": ways, "count": len(ways), "source": source_name}
                if ways:
                    road_response_cache[cache_key] = {"time": now, "data": result}
                if len(road_response_cache) > 300:
                    for key, value in sorted(road_response_cache.items(), key=lambda item: item[1]["time"]):
                        if now - value["time"] > 21600 or len(road_response_cache) > 300:
                            road_response_cache.pop(key, None)
                        if len(road_response_cache) <= 240:
                            break
                if ways:
                    return result
                errors.append(f"{endpoint}: valid JSON but zero road ways returned")
            except Exception as exc:
                errors.append(f"{endpoint}: {type(exc).__name__}: {exc}")
                continue

    # Last-resort fallback: request routes that START at the player's location.
    # Earlier we routed between two random points, which often produced a route
    # several hundred metres away and left the local traffic filter with zero segments.
    try:
        route_ways = []
        destinations = [
            (lat + 0.0040, lon),
            (lat - 0.0040, lon),
            (lat, lon + 0.0040 / max(0.2, math.cos(math.radians(lat)))),
            (lat, lon - 0.0040 / max(0.2, math.cos(math.radians(lat)))),
        ]
        async def get_route(dest_lat, dest_lon, route_index):
            dest_lat = max(-85, min(85, dest_lat))
            dest_lon = max(-180, min(180, dest_lon))
            route_url = (
                f"https://router.project-osrm.org/route/v1/driving/"
                f"{lon:.6f},{lat:.6f};{dest_lon:.6f},{dest_lat:.6f}"
            )
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(7.0, connect=3.0),
                follow_redirects=True,
                headers={"User-Agent": "WorldGame/1.0 (road traffic; OpenStreetMap attribution)"}
            ) as client:
                response = await client.get(route_url, params={
                    "overview": "full", "geometries": "geojson", "alternatives": "false", "steps": "false"
                })
            response.raise_for_status()
            payload = response.json()
            result_ways = []
            for route in payload.get("routes", []):
                coords = (route.get("geometry") or {}).get("coordinates") or []
                points = [{"lat": float(p[1]), "lon": float(p[0])}
                          for p in coords if isinstance(p, (list, tuple)) and len(p) >= 2]
                if len(points) >= 2:
                    result_ways.append({
                        "id": f"osrm-local-{route_index}",
                        "tags": {"highway": "road", "name": "OpenStreetMap nearby road"},
                        "geometry": points
                    })
            return result_ways
        route_results = await asyncio.gather(
            *(get_route(dlat, dlon, idx) for idx, (dlat, dlon) in enumerate(destinations)),
            return_exceptions=True
        )
        for route_result in route_results:
            if isinstance(route_result, Exception):
                errors.append(f"OSRM nearby route: {type(route_result).__name__}: {route_result}")
            else:
                route_ways.extend(route_result)
        if route_ways:
            return {
                "ways": route_ways,
                "count": len(route_ways),
                "source": "OSRM / OpenStreetMap (routes anchored at player)",
                "fallback": True,
                "errors": errors
            }
    except Exception as exc:
        errors.append(f"OSRM route fallback: {type(exc).__name__}: {exc}")
        print(f"OSRM route fallback failed near {lat:.3f},{lon:.3f}: {type(exc).__name__}: {exc}")

    # If every upstream is down, reuse older nearby cached roads rather than fail hard.
    stale = []
    for (cached_lat, cached_lon, _bucket), value in road_response_cache.items():
        age = now - value["time"]
        if age <= 21600 and abs(cached_lat - round(lat, 3)) <= 0.015 and abs(cached_lon - round(lon, 3)) <= 0.015:
            stale.append((age, value["data"]))
    if stale:
        result = dict(min(stale, key=lambda item: item[0])[1])
        result["stale"] = True
        return result

    print(f"All road sources failed near {lat:.3f},{lon:.3f}: {' | '.join(errors)}")
    # Return an empty, valid response so traffic can gracefully remain disabled.
    return {"ways": [], "count": 0, "source": "OpenStreetMap", "unavailable": True, "errors": errors, "searched_radius": radius, "coordinates": {"lat": lat, "lon": lon}}

@app.get("/api/players")
async def players(user=Depends(current_user)):
    if db is None:
        raise HTTPException(503, "MongoDB не настроена.")
    docs = await db.players.find({"online": True}, {"_id": 0}).to_list(length=500)
    return {"players": docs}

@app.put("/api/player/position")
async def update_position(payload: PositionPayload, user=Depends(current_user)):
    if db is None:
        raise HTTPException(503, "MongoDB не настроена.")
    pos = payload.model_dump()
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"position": pos, "mode": pos["mode"], "aircraft": pos["aircraft"]}})
    doc = {"user_id": user["_id"], "username": user["username"], "country_code": user.get("country_code"),
           **pos, "online": True, "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.players.update_one({"user_id": user["_id"]}, {"$set": doc}, upsert=True)
    await broadcast({"type": "player_position", "player": {k:v for k,v in doc.items() if k != "user_id"}}, skip=user["_id"])
    return {"ok": True}

@app.post("/api/invites")
async def invite(payload: InvitePayload, user=Depends(current_user)):
    target = await db.users.find_one({"username_lower": payload.target.lower()})
    if not target:
        raise HTTPException(404, "Игрок не найден.")
    if target["_id"] not in online_sockets:
        raise HTTPException(409, "Игрок сейчас не в сети.")
    await online_sockets[target["_id"]].send_json({"type": "invite", "from": user["username"], "country": user.get("country_code"), "message": payload.message})
    return {"ok": True}

@app.get("/api/imagery/{z}/{y}/{x}")
async def proxy_satellite_imagery(z: int, y: int, x: int):
    # Proxy Esri satellite tiles through this origin to avoid browser CORS restrictions.
    if z < 0 or z > 19:
        raise HTTPException(status_code=400, detail="Invalid imagery zoom")
    limit = 2 ** z
    if x < 0 or y < 0 or x >= limit or y >= limit:
        raise HTTPException(status_code=400, detail="Invalid imagery tile coordinates")
    url = f"https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            upstream = await client.get(url)
            upstream.raise_for_status()
            content_type = upstream.headers.get("content-type", "image/jpeg")
            return Response(content=upstream.content, media_type=content_type,
                            headers={"Cache-Control": "public, max-age=86400"})
    except Exception as exc:
        print(f"Satellite tile proxy failed z={z} y={y} x={x}: {exc}")
        raise HTTPException(status_code=502, detail="Satellite imagery tile temporarily unavailable")


MODEL_URLS = {
    "airbus-a320": "https://raw.githubusercontent.com/wprojecter-cmd/flight-simulator/main/airbus_a320_s7_airlines.glb",
    "sr72-darkstar": "https://raw.githubusercontent.com/supermanone-boop/models/main/lockheed_martin_sr72_darkstar__topgun_maverick.glb",
    "airbus-a380": "https://raw.githubusercontent.com/amvlab/aircraft-models/main/models/A380_nologo.glb",
    "boeing-737": "https://raw.githubusercontent.com/amvlab/aircraft-models/main/models/B737_nologo.glb",
    "boeing-787": "https://raw.githubusercontent.com/amvlab/aircraft-models/main/models/B787_nologo.glb",
    "airbus-a350": "https://raw.githubusercontent.com/amvlab/aircraft-models/main/models/A350_nologo.glb",
    "an124": "https://raw.githubusercontent.com/supermanone-boop/models/main/an124.glb",
    "su57": "https://raw.githubusercontent.com/supermanone-boop/models/main/su57.glb",
    "b52": "https://raw.githubusercontent.com/supermanone-boop/models/main/boeing_b-52_stratofortress.glb",
    "sh60": "https://raw.githubusercontent.com/supermanone-boop/models/main/sh-60b_seahawk_helicopter.glb",
    "c130": "https://raw.githubusercontent.com/supermanone-boop/models/main/lockheed_martin_c130jsuper_hercules_reupload.glb",
    "evtol": "https://raw.githubusercontent.com/amvlab/aircraft-models/main/models/EVTOL_nologo.glb",
    "drone": "https://raw.githubusercontent.com/amvlab/aircraft-models/main/models/drone_nologo.glb",
}

@app.get("/api/models/{model_id}.glb")
async def aircraft_model(model_id: str):
    url = MODEL_URLS.get(model_id)
    if not url:
        raise HTTPException(404, "Неизвестная модель самолёта.")
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
            upstream = await client.get(url)
            upstream.raise_for_status()
        raw = upstream.content
        if len(raw) < 20 or raw[:4] != b"glTF":
            raise HTTPException(502, f"Источник модели {model_id} вернул не GLB.")
        version, total_length = struct.unpack_from("<II", raw, 4)
        json_length, json_type = struct.unpack_from("<II", raw, 12)
        if version != 2 or json_type != 0x4E4F534A or json_length > len(raw) - 20:
            raise HTTPException(502, f"Некорректный GLB у модели {model_id}.")
        try:
            document = json.loads(raw[20:20 + json_length].decode("utf-8").rstrip(" \t\r\n\0"))
            # Cesium 1.132 can fail compiling some third-party anisotropy materials.
            for material in document.get("materials", []):
                extensions = material.get("extensions", {})
                extensions.pop("KHR_materials_anisotropy", None)
                if not extensions:
                    material.pop("extensions", None)
            for key in ("extensionsUsed", "extensionsRequired"):
                if key in document:
                    document[key] = [name for name in document[key] if name != "KHR_materials_anisotropy"]
                    if not document[key]:
                        document.pop(key, None)
            clean_json = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            clean_json += b" " * ((4 - len(clean_json) % 4) % 4)
            rest = raw[20 + json_length:]
            result = b"glTF" + struct.pack("<II", version, 12 + 8 + len(clean_json) + len(rest))
            result += struct.pack("<II", len(clean_json), 0x4E4F534A) + clean_json + rest
            return Response(result, media_type="model/gltf-binary", headers={"Cache-Control": "public, max-age=3600"})
        except (ValueError, UnicodeDecodeError, KeyError) as exc:
            print(f"Could not sanitize aircraft GLB {model_id}: {exc}")
            return Response(raw, media_type="model/gltf-binary", headers={"Cache-Control": "public, max-age=3600"})
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Aircraft model proxy failed ({model_id}): {exc}")
        raise HTTPException(502, f"Не удалось загрузить модель {model_id} из источника.")

@app.get("/api/temperature-tiles/{z}/{x}/{y}.png")
async def temperature_tile(z: int, x: int, y: int):
    if not OPENWEATHER_API_KEY:
        raise HTTPException(503, "Температурный слой требует OPENWEATHER_API_KEY в Render Environment.")
    if not (0 <= z <= 18 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise HTTPException(400, "Недопустимые координаты тайла.")
    url = f"https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png"
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            tile = await client.get(url, params={"appid": OPENWEATHER_API_KEY})
            if tile.status_code in (401, 403):
                raise HTTPException(503, "OpenWeather отклонил ключ или не включил доступ к погодным тайлам.")
            tile.raise_for_status()
            return Response(content=tile.content, media_type="image/png",
                            headers={"Cache-Control": "public, max-age=900"})
    except HTTPException:
        raise
    except Exception as exc:
        print(f"OpenWeather temperature tile failed z={z} x={x} y={y}: {exc}")
        raise HTTPException(502, "Температурный тайл временно недоступен.")


@app.get("/api/weather")
async def weather(lat: float, lon: float):
    lat = max(-90, min(90, lat))
    lon = max(-180, min(180, lon))
    errors = []
    async with httpx.AsyncClient(timeout=12, follow_redirects=True, headers={"User-Agent": "WorldGame/1.0 weather dashboard"}) as client:
        try:
            r = await client.get("https://api.open-meteo.com/v1/forecast", params={"latitude": lat, "longitude": lon, "current": "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m", "timezone": "auto"})
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            errors.append("Open-Meteo: " + str(exc))
        try:
            r = await client.get(f"https://wttr.in/{lat:.4f},{lon:.4f}", params={"format": "j1"})
            r.raise_for_status()
            payload = r.json()
            current = (payload.get("current_condition") or [{}])[0]
            def num(value, default=0):
                try: return float(value)
                except (TypeError, ValueError): return default
            temp = num(current.get("temp_C"))
            code = str(current.get("weatherCode", ""))
            code_map = {"113":0,"116":2,"119":3,"122":3,"143":45,"248":45,"263":51,"296":61,"302":61,"308":61,"326":71,"332":71,"338":71,"389":95}
            return {"current": {"temperature_2m": temp, "relative_humidity_2m": num(current.get("humidity")), "apparent_temperature": num(current.get("FeelsLikeC"), temp), "is_day": 1, "precipitation": num(current.get("precipMM")), "weather_code": code_map.get(code, 2), "wind_speed_10m": num(current.get("windspeedKmph")), "wind_direction_10m": num(current.get("winddirDegree"))}, "timezone": "local"}
        except Exception as exc:
            errors.append("wttr.in: " + str(exc))
    print("Weather providers unavailable:", " | ".join(errors))
    return JSONResponse(status_code=200, content={"current": None, "unavailable": True, "message": "Погода временно недоступна для этой точки."})

rainviewer_path_cache = {"path": None, "fetched_at": 0.0}

@app.get("/api/weather-tiles/{z}/{x}/{y}.png")
async def weather_tile(z: int, x: int, y: int):
    global rainviewer_path_cache
    if not (0 <= z <= 18 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise HTTPException(400, "Недопустимые координаты тайла.")
    try:
        now = time.monotonic()
        radar_path = rainviewer_path_cache.get("path")
        if not radar_path or now - rainviewer_path_cache.get("fetched_at", 0) > 300:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                meta = await client.get("https://api.rainviewer.com/public/weather-maps.json")
                meta.raise_for_status()
                payload = meta.json()
                frames = (payload.get("radar", {}).get("nowcast") or []) or (payload.get("radar", {}).get("past") or [])
                if not frames or not frames[-1].get("path"):
                    raise RuntimeError("RainViewer не вернул доступные радарные кадры")
                radar_path = frames[-1]["path"]
                rainviewer_path_cache = {"path": radar_path, "fetched_at": now}
        url = f"https://tilecache.rainviewer.com{radar_path}/256/{z}/{x}/{y}/2/1_1.png"
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
            tile = await client.get(url)
            tile.raise_for_status()
            return Response(content=tile.content, media_type="image/png", headers={"Cache-Control": "public, max-age=300"})
    except Exception as exc:
        print(f"RainViewer weather tile failed z={z} x={x} y={y}: {exc}")
        raise HTTPException(502, "Радар погоды временно недоступен.")

@app.post("/api/cesium/token")
async def create_cesium_token(request: Request, user=Depends(current_user)):
    if not CESIUM_ION_ADMIN_TOKEN:
        if CESIUM_ION_TOKEN:
            return {"token": CESIUM_ION_TOKEN, "shared": True, "message": "Используется общий токен приложения."}
        raise HTTPException(503, "Добавьте CESIUM_ION_TOKEN или CESIUM_ION_ADMIN_TOKEN в Render.")
    origin = str(request.base_url).rstrip("/")
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.post("https://api.cesium.com/v2/tokens",
                headers={"Authorization": f"Bearer {CESIUM_ION_ADMIN_TOKEN}", "Content-Type": "application/json"},
                json={"name": f"World Game player {user['username']}", "scopes": ["assets:read", "geocode"],
                      "allowedUrls": [origin]})
            if r.status_code >= 400:
                raise HTTPException(502, f"Cesium ion не создал токен ({r.status_code}). Проверьте tokens:write у CESIUM_ION_ADMIN_TOKEN.")
            data = r.json()
            token = data.get("token") or data.get("accessToken")
            if not token:
                raise HTTPException(502, "Cesium ion не вернул токен.")
            return {"token": token, "shared": False}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, f"Ошибка Cesium ion: {exc}")

@app.post("/api/ai/invite")
async def ai_invite(user=Depends(current_user)):
    if not GROQ_API_KEY:
        raise HTTPException(503, "Добавьте GROQ_API_KEY в Render, чтобы общаться с ИИ-странами.")
    if db is None:
        raise HTTPException(503, "MongoDB не настроена.")
    country = user.get("country_code") or "неизвестной страны"
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    messages = [
        {"role": "system", "content": "Ты дипломатический ИИ-игрок в многопользовательской игре World Game. Отвечай на русском кратко, дружелюбно, от лица одной из свободных стран. Не утверждай, что реальный самолёт или игрок физически существует."},
        {"role": "user", "content": f"Игрок {user['username']} из страны {country} приглашает тебя на встречу или совместный полёт. Прими или предложи встречу в своей стране. Ответь 1-3 предложениями."}
    ]
    # Groq retires model IDs periodically. Try current and fallback models on model-specific 400/404 errors.
    models = ["openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
    errors = []
    async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
        for model in models:
            try:
                response = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers=headers,
                    json={"model": model, "messages": messages, "temperature": 0.7, "max_tokens": 220}
                )
                if response.status_code in (400, 404):
                    errors.append(f"{model}: HTTP {response.status_code}")
                    continue
                if response.status_code == 401:
                    raise HTTPException(503, "Groq отклонил API-ключ. Проверьте GROQ_API_KEY в Render.")
                response.raise_for_status()
                data = response.json()
                reply = data.get("choices", [{}])[0].get("message", {}).get("content")
                if reply:
                    return {"reply": reply, "model": model}
                errors.append(f"{model}: пустой ответ")
            except HTTPException:
                raise
            except httpx.HTTPStatusError as exc:
                errors.append(f"{model}: HTTP {exc.response.status_code}")
            except Exception as exc:
                errors.append(f"{model}: {type(exc).__name__}")
    print("Groq models unavailable:", "; ".join(errors))
    raise HTTPException(502, "Groq не смог ответить. Проверьте GROQ_API_KEY и доступные модели в Groq Console.")

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = ""):
    await ws.accept()
    uid = None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        uid = payload["sub"]
        if db is None:
            await ws.send_json({"type":"error","message":"MongoDB не настроена"})
            await ws.close()
            return
        user = await db.users.find_one({"_id": uid})
        if not user:
            await ws.close(code=4401)
            return
        async with socket_lock:
            online_sockets[uid] = ws
            socket_users[uid] = public_user(user)
        await db.players.update_one({"user_id": uid}, {"$set": {"online": True, "username": user["username"], "country_code": user.get("country_code")}}, upsert=True)
        await broadcast({"type":"presence","username":user["username"],"online":True}, skip=uid)
        await ws.send_json({"type":"connected","username":user["username"]})
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind in ("voice_offer","voice_answer","ice_candidate","voice_leave","chat"):
                target = msg.get("target")
                target_user = await db.users.find_one({"username_lower": str(target or "").lower()}) if target else None
                if target_user and target_user["_id"] in online_sockets:
                    await online_sockets[target_user["_id"]].send_json({"type":kind,"from":user["username"],"payload":msg.get("payload"),"message":msg.get("message")})
                elif kind == "chat":
                    await broadcast({"type":"chat","from":user["username"],"message":str(msg.get("message",""))[:500]}, skip=uid)
    except (WebSocketDisconnect, JWTError, KeyError):
        pass
    except Exception as exc:
        print("WebSocket error:", exc)
    finally:
        if uid:
            async with socket_lock:
                online_sockets.pop(uid, None)
                socket_users.pop(uid, None)
            if db is not None:
                await db.players.update_one({"user_id": uid}, {"$set": {"online": False}})
                try:
                    await broadcast({"type":"presence","username":user.get("username","Игрок"),"online":False}, skip=uid)
                except Exception:
                    pass
