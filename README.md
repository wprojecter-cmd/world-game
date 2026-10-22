# World Game

Browser-based persistent multiplayer world built with FastAPI, MongoDB, WebSockets and CesiumJS.

## Run locally
1. Install Python 3.12+.
2. `pip install -r requirements.txt`
3. Set `MONGO_URI` to a MongoDB Atlas connection string and `SECRET_KEY` to a long random value.
4. Optional: set `CESIUM_ION_TOKEN` for Cesium ion terrain and `GROQ_API_KEY` for AI-country dialogue.
5. Run `uvicorn server:app --reload` and open http://127.0.0.1:8000.

## Render
The repository contains `render.yaml`. In Render choose **New → Blueprint** and select this repository. Set the secret environment variables in the dashboard. `MONGO_URI` must be a MongoDB Atlas URI with network access enabled for Render. Never commit secrets.

## Notes
- Without a Cesium ion token, the globe uses ellipsoid terrain and public imagery fallback; premium ion terrain requires a valid token.
- To create restricted per-app Cesium tokens automatically, configure `CESIUM_ION_ADMIN_TOKEN` with a Cesium ion token that has `tokens:write`. Keep it server-side only.
- Voice uses browser WebRTC and requires microphone permission; HTTPS is required in production. It is opt-in and attempts to connect online players who have enabled their microphones.
- AI countries are seeded in MongoDB and their simulated aircraft positions change periodically; Groq generates diplomatic invite responses when configured.
- The aircraft hangar contains the S7 A320 and SR-72 entries plus additional model entries. Some third-party model URLs may need to be replaced if the hosting source removes them; test the model requests in the browser console.
- Free Render instances may sleep when idle. Real-time multiplayer needs an always-on service for best results.
