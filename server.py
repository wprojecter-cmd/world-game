import os
import asyncio
import secrets
import hashlib
import hmac
import time
import random
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
    if not db:
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
    return {"cesiumToken": CESIUM_ION_TOKEN, "cesiumConfigured": bool(CESIUM_ION_TOKEN), "voiceEnabled": True}

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

@app.get("/api/weather")
async def weather(lat: float, lon: float):
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get("https://api.open-meteo.com/v1/forecast", params={
                "latitude": max(-90,min(90,lat)), "longitude": max(-180,min(180,lon)),
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
                "timezone": "auto"})
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            raise HTTPException(502, f"Не удалось получить погоду: {exc}")

@app.get("/api/weather-tiles/{z}/{x}/{y}.png")
async def weather_tile(z: int, x: int, y: int):
    if not OPENWEATHER_API_KEY:
        raise HTTPException(503, "Добавьте OPENWEATHER_API_KEY в Render для погодного слоя.")
    if not (0 <= z <= 18 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise HTTPException(400, "Недопустимые координаты тайла.")
    url = "https://tile.openweathermap.org/map/precipitation_new/%d/%d/%d.png" % (z, x, y)
    async with httpx.AsyncClient(timeout=12) as client:
        try:
            r = await client.get(url, params={"appid": OPENWEATHER_API_KEY})
            if r.status_code != 200:
                raise HTTPException(502, "OpenWeather не вернул тайл. Проверьте API-ключ и доступ к картам.")
            return Response(content=r.content, media_type="image/png", headers={"Cache-Control": "public, max-age=300"})
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, "OpenWeather недоступен: " + str(exc))

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
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            r = await client.post("https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json={"model": "llama-3.3-70b-versatile", "messages":[
                    {"role":"system","content":"Ты дипломатический ИИ-игрок в многопользовательской игре World Game. Отвечай на русском кратко, дружелюбно, от лица одной из свободных стран. Не утверждай, что реальный самолёт или игрок физически существует."},
                    {"role":"user","content":f"Игрок {user['username']} из страны {country} приглашает тебя на встречу или совместный полёт. Прими или предложи встречу в своей стране. Ответь 1-3 предложениями."}]})
            r.raise_for_status()
            return {"reply": r.json()["choices"][0]["message"]["content"]}
        except Exception as exc:
            raise HTTPException(502, f"Ошибка Groq API: {exc}")

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
