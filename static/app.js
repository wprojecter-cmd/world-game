(()=>{'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function filterPoliticalBoundaries(data){if(!data||!Array.isArray(data.features))return data;const hiddenName=/(?:^|\\b)(?:palestine|palästina|palestina|west bank and gaza|state of palestine|palestinian territories|gaza strip|northern cyprus|north cyprus|n\\.\\s*cyprus|turkish republic of northern cyprus|trnc)(?:\\b|$)/i;const hiddenCodes=new Set(['PSE','PSX','CYN','NCT','NCY']);const nameKeys=['name','NAME','NAME_EN','NAME_LONG','NAME_RU','ADMIN','admin','FORMAL_EN','formal_en','BRK_NAME','NAME_SORT','GEOUNIT','SUBUNIT','SOVEREIGNT','NAME_ALT','NAMEALT'];const codeKeys=['ISO3166-1-Alpha-3','ISO_A3','ISO_A3_EH','ADM0_A3','GU_A3','BRK_A3','SOV_A3','iso_a3'];data.features=data.features.filter(feature=>{const p=feature?.properties||{};const names=nameKeys.flatMap(k=>[p[k]]).filter(v=>typeof v==='string');const codes=codeKeys.map(k=>p[k]).filter(v=>typeof v==='string'||typeof v==='number').map(v=>String(v).toUpperCase());return !names.some(n=>hiddenName.test(n.trim()))&&!codes.some(c=>hiddenCodes.has(c))});return data}
const modelScaleCache=new Map();let terrainGroundHeight=0,terrainSampleAt=0;let token=localStorage.getItem('wg_token')||'', user=null, authMode='login', viewer=null, countryViewer=null, countryBorders=null, selectedCountryEntity=null, borderSource=null, weatherLayer=null, miniMap=null, spawnMap=null, spawnMarker=null, playerEntity=null, playerEntityUri='', remoteEntities={}, remoteModelUris={}, openWeatherEnabled=false, selectedAircraft='airbus-a320', mode='human', destination=null, position={lat:20,lon:0,alt:0,heading:0,pitch:0,roll:0}, socket=null, localStream=null, peer=null, muted=false, clockTimer=null, movementTimer=null;
const planes=[
{id:'airbus-a320',name:'Airbus A320 · S7 Airlines',type:'Пассажирский',url:'/api/models/airbus-a320.glb'},
{id:'sr72-darkstar',name:'Lockheed Martin SR-72 Darkstar',type:'Гиперзвуковой',url:'/api/models/sr72-darkstar.glb'},
{id:'airbus-a380',name:'Airbus A380',type:'Двухпалубный',url:'/api/models/airbus-a380.glb'},
{id:'boeing-737',name:'Boeing 737',type:'Пассажирский',url:'/api/models/boeing-737.glb'},
{id:'boeing-787',name:'Boeing 787 Dreamliner',type:'Дальнемагистральный',url:'/api/models/boeing-787.glb'},
{id:'airbus-a350',name:'Airbus A350',type:'Дальнемагистральный',url:'/api/models/airbus-a350.glb'},
{id:'an124',name:'Antonov An-124 Ruslan',type:'Тяжёлый транспортный',url:'/api/models/an124.glb'},
{id:'su57',name:'Су-57',type:'Истребитель',url:'/api/models/su57.glb'},
{id:'b52',name:'Boeing B-52 Stratofortress',type:'Стратегический бомбардировщик',url:'/api/models/b52.glb'},
{id:'sh60',name:'SH-60 Seahawk',type:'Вертолёт',url:'/api/models/sh60.glb'},
{id:'c130',name:'Lockheed C-130J Hercules',type:'Военно-транспортный',url:'/api/models/c130.glb'},
{id:'evtol',name:'eVTOL',type:'Электрический летательный аппарат',url:'/api/models/evtol.glb'},
{id:'drone',name:'Дрон',type:'Беспилотник',url:'/api/models/drone.glb'}
];
const countries=[['US','США',38,-97],['CA','Канада',56,-106],['MX','Мексика',23,-102],['BR','Бразилия',-10,-55],['AR','Аргентина',-34,-64],['GB','Великобритания',55,-3],['FR','Франция',46,2],['DE','Германия',51,10],['IT','Италия',42,12],['ES','Испания',40,-4],['PT','Португалия',39,-8],['NL','Нидерланды',52,5],['BE','Бельгия',50.5,4.5],['CH','Швейцария',47,8],['PL','Польша',52,19],['UA','Украина',49,32],['RU','Россия',60,90],['TR','Турция',39,35],['IL','Израиль',31.5,34.8],['EG','Египет',26,30],['ZA','ЮАР',-29,24],['NG','Нигерия',9,8],['KE','Кения',0,38],['SA','Саудовская Аравия',24,45],['AE','ОАЭ',24,54],['IN','Индия',21,78],['PK','Пакистан',30,70],['CN','Китай',35,103],['JP','Япония',36,138],['KR','Южная Корея',36,128],['TH','Таиланд',15,101],['VN','Вьетнам',16,108],['ID','Индонезия',-2,118],['AU','Австралия',-25,133],['NZ','Новая Зеландия',-41,174],['KZ','Казахстан',48,68],['UZ','Узбекистан',41,64],['NO','Норвегия',62,10],['SE','Швеция',60,18],['FI','Финляндия',64,26],['GR','Греция',39,22],['RO','Румыния',46,25],['CZ','Чехия',49.8,15.5],['AT','Австрия',47.5,14.5],['IE','Ирландия',53,-8],['IS','Исландия',65,-18],['CL','Чили',-30,-71],['CO','Колумбия',4,-72],['PE','Перу',-9,-75],['CU','Куба',22,-79],['MA','Марокко',32,-6],['ET','Эфиопия',9,40],['GH','Гана',8,-2],['QA','Катар',25.3,51.2],['SG','Сингапур',1.3,103.8],['MY','Малайзия',4,102],['PH','Филиппины',13,122],['BD','Бангладеш',24,90],['NP','Непал',28,84],['AF','Афганистан',33,65],['IQ','Ирак',33,44],['IR','Иран',32,53],['SY','Сирия',35,38],['JO','Иордания',31,36],['LB','Ливан',34,36],['TN','Тунис',34,9],['DZ','Алжир',28,3],['LY','Ливия',26,17],['SD','Судан',13,30],['TZ','Танзания',-6,35],['UG','Уганда',1,32],['ZW','Зимбабве',-19,29],['AO','Ангола',-12,18],['SN','Сенегал',14,-14],['VE','Венесуэла',8,-66],['EC','Эквадор',-2,-77],['BO','Боливия',-17,-65],['PY','Парагвай',-23,-58],['UY','Уругвай',-33,-56],['CR','Коста-Рика',10,-84],['PA','Панама',9,-80],['GT','Гватемала',15,-90],['HN','Гондурас',15,-86],['DO','Доминикана',19,-70],['HR','Хорватия',45,16],['RS','Сербия',44,21],['BG','Болгария',43,25],['HU','Венгрия',47,19],['SK','Словакия',48.7,19.7],['DK','Дания',56,10],['EE','Эстония',59,26],['LV','Латвия',57,25],['LT','Литва',55,24],['GE','Грузия',42,43],['AM','Армения',40,45],['AZ','Азербайджан',40,48],['BY','Беларусь',53,28],['MD','Молдова',47,29],['MM','Мьянма',21,96],['KH','Камбоджа',12,105],['LA','Лаос',19,103],['KP','КНДР',40,127],['LK','Шри-Ланка',7,81],['MN','Монголия',46,104],['PG','Папуа — Новая Гвинея',-6,147],['FJ','Фиджи',-18,178],['IS','Исландия',65,-18],['LU','Люксембург',49.8,6.1]];
countries.push(
['AL','Албания',41,20],['AD','Андорра',42.5,1.5],['BA','Босния и Герцеговина',44,18],['ME','Черногория',42.5,19.3],['MK','Северная Македония',41.6,21.7],['SI','Словения',46.1,14.8],['CY','Кипр',35,33],['MT','Мальта',35.9,14.4],['LI','Лихтенштейн',47.2,9.5],['MC','Монако',43.7,7.4],['SM','Сан-Марино',43.9,12.5],['VA','Ватикан',41.9,12.45],
['BJ','Бенин',9.3,2.3],['BF','Буркина-Фасо',12.3,-1.5],['BI','Бурунди',-3.4,29.9],['BW','Ботсвана',-22,24],['CF','ЦАР',6.6,20.9],['TD','Чад',15,19],['KM','Коморы',-11.7,43.3],['CG','Республика Конго',-1,15.8],['CD','ДР Конго',-3,23.7],['CI','Кот-д’Ивуар',7.5,-5.5],['DJ','Джибути',11.8,42.6],['GQ','Экваториальная Гвинея',1.6,10.5],['ER','Эритрея',15,39],['GA','Габон',-0.6,11.6],['GM','Гамбия',13.4,-16.6],['GN','Гвинея',10.4,-10.8],['GW','Гвинея-Бисау',12,-15],['LS','Лесото',-29.6,28.2],['LR','Либерия',6.4,-9.4],['MG','Мадагаскар',-19,46.7],['MW','Малави',-13.3,34.3],['ML','Мали',17,-4],['MR','Мавритания',20,-10],['MU','Маврикий',-20.2,57.5],['MZ','Мозамбик',-18.7,35.5],['NA','Намибия',-22,17],['NE','Нигер',17.6,8.1],['RW','Руанда',-2,30],['SC','Сейшелы',-4.7,55.5],['SL','Сьерра-Леоне',8.5,-11.8],['SO','Сомали',5,46],['SS','Южный Судан',7,30],['SZ','Эсватини',-26.5,31.5],['TG','Того',8.6,1.2],['ZM','Замбия',-13.1,27.8],
['BT','Бутан',27.5,90.5],['BN','Бруней',4.5,114.7],['TL','Восточный Тимор',-8.8,125.7],['MV','Мальдивы',3.2,73.2],['TM','Туркменистан',39,59],['YE','Йемен',15.5,48.5],['PS','Палестина',31.9,35.2],['OM','Оман',21,57],['KW','Кувейт',29.3,47.5],['BH','Бахрейн',26,50.5],
['BZ','Белиз',17.2,-88.7],['SV','Сальвадор',13.8,-88.9],['NI','Никарагуа',12.9,-85],['JM','Ямайка',18.1,-77.3],['HT','Гаити',19,-72.7],['BS','Багамы',24.3,-76],['BB','Барбадос',13.2,-59.5],['GD','Гренада',12.1,-61.7],['DM','Доминика',15.4,-61.3],['LC','Сент-Люсия',13.9,-60.98],['VC','Сент-Винсент и Гренадины',13.2,-61.2],['AG','Антигуа и Барбуда',17.1,-61.8],['KN','Сент-Китс и Невис',17.3,-62.7],['TT','Тринидад и Тобаго',10.7,-61.2],['GY','Гайана',5,-58.9],['SR','Суринам',4,-56],
['WS','Самоа',-13.8,-172.1],['TO','Тонга',-21.2,-175.1],['VU','Вануату',-16,167],['SB','Соломоновы Острова',-9.6,160],['KI','Кирибати',1.9,-157.4],['NR','Науру',-0.5,166.9],['TV','Тувалу',-8.5,179.2],['FM','Микронезия',6.9,158.2],['MH','Маршалловы Острова',7.1,171.2],['PW','Палау',7.5,134.5]
);

function toast(s){const t=$('#toast');t.textContent=s;t.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.style.display='none',3600)}
async function api(path,opts={}){const headers={'Content-Type':'application/json',...(opts.headers||{})};if(token)headers.Authorization='Bearer '+token;let r=await fetch(path,{...opts,headers});let d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.detail||d.message||('Ошибка '+r.status));return d}
function showAuth(){ $('#auth-screen').classList.remove('hidden');$('#country-screen').classList.add('hidden');$('#game').classList.add('hidden')}
async function showGame(){ $('#auth-screen').classList.add('hidden');$('#country-screen').classList.add('hidden');$('#game').classList.remove('hidden');$('#world-loading')?.classList.add('hidden');$('#welcome').textContent='Игрок '+user.username;await initGlobe();connectSocket();renderPlanes();refreshPlayers();updateWeather();startClock();startMovement()}
function setAuthMode(v){authMode=v;$$('[data-auth]').forEach(b=>b.classList.toggle('active',b.dataset.auth===v));$('#auth-submit').textContent=v==='login'?'Войти в мир':'Создать аккаунт';$('#password').autocomplete=v==='login'?'current-password':'new-password';$('#auth-error').textContent=''}
$$('[data-auth]').forEach(b=>b.onclick=()=>setAuthMode(b.dataset.auth));
$('#auth-form').onsubmit=async e=>{e.preventDefault();$('#auth-error').textContent='';try{const d=await api('/api/auth/'+authMode,{method:'POST',body:JSON.stringify({username:$('#username').value.trim(),password:$('#password').value})});token=d.token;localStorage.setItem('wg_token',token);user=d.user;if(d.needsCountry)showCountry();else showGame()}catch(err){$('#auth-error').textContent=err.message}};
async function restore(){if(!token)return showAuth();try{const d=await api('/api/auth/me');user=d.user;if(d.needsCountry)showCountry();else showGame()}catch{token='';localStorage.removeItem('wg_token');showAuth()}}
async function showCountry(){
 $('#auth-screen').classList.add('hidden');$('#country-screen').classList.remove('hidden');$('#game').classList.add('hidden');
 const s=$('#country-select');s.innerHTML='';
 countries.forEach(c=>{let o=document.createElement('option');o.value=c[0];o.textContent=c[1]+' ('+c[0]+')';o.dataset.lat=c[2];o.dataset.lon=c[3];s.append(o)});
 try{const state=await api('/api/countries');const taken=new Set((state.taken||[]).map(x=>x.country_code));const ai=new Set((state.ai||[]).map(x=>x.country_code));[...s.options].forEach(o=>{if((taken.has(o.value)&&state.taken.find(x=>x.country_code===o.value)?.user_id!==user?.id)||ai.has(o.value)){o.disabled=true;o.textContent+=' · занята'}})}catch(e){console.warn('Country occupancy unavailable',e)}
 const chooseCountry=(code,fly=true)=>{const opt=[...s.options].find(o=>o.value===code);if(!opt)return false;if(opt.disabled){$('#country-pick-status').textContent='Эта страна уже занята игроком или управляется ИИ. Выбери другую.';return false}s.value=code;const lat=Number(opt.dataset.lat),lon=Number(opt.dataset.lon);$('#spawn-lat').value=lat;$('#spawn-lon').value=lon;$('#country-pick-status').textContent='Выбрана страна: '+opt.textContent.replace(/ \([^)]*\)/,'');if(countryBorders){if(selectedCountryEntity?.polygon){selectedCountryEntity.polygon.material=Cesium.Color.CYAN.withAlpha(.20);selectedCountryEntity.polygon.outline=false}selectedCountryEntity=countryBorders.entities.values.find(e=>countryCodeOf(e)===code)||null;if(selectedCountryEntity?.polygon){selectedCountryEntity.polygon.material=Cesium.Color.fromBytes(35,155,255,85);selectedCountryEntity.polygon.outline=false}}if(fly&&countryViewer)countryViewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lon,lat,Math.max(1500000,code==='RU'?8500000:3200000)),duration:.8});if(spawnMarker)spawnMarker.setLatLng([lat,lon]);return true};
 s.onchange=()=>chooseCountry(s.value,true);
 if(!countryViewer&&window.Cesium){try{
  countryViewer=new Cesium.Viewer('country-globe',{animation:false,timeline:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,terrainProvider:new Cesium.EllipsoidTerrainProvider(),baseLayer:false});
  countryViewer.scene.globe.enableLighting=true;countryViewer.scene.globe.depthTestAgainstTerrain=true;
  // Use a real multi-zoom satellite tile service instead of Cesium's low-detail Natural Earth texture.
  try{countryViewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:'/api/imagery/{z}/{y}/{x}',maximumLevel:19,credit:'Esri, Maxar, Earthstar Geographics'}))}catch(imgErr){console.warn('Satellite imagery unavailable; using OSM tile imagery:',imgErr);countryViewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:'/api/imagery/{z}/{y}/{x}',maximumLevel:19,credit:'Satellite imagery © Esri'}))}
  const cfg=await fetch('/api/config').then(r=>r.json());await configureCesiumWorld(countryViewer,cfg);countryViewer.scene.globe.show=true;countryViewer.scene.globe.showWaterEffect=true;countryViewer.scene.globe.enableLighting=true;
  const geoUrl='https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
  const geoResponse=await fetch(geoUrl);if(!geoResponse.ok)throw new Error('Не удалось загрузить географические границы: HTTP '+geoResponse.status);
  const geoJson=filterPoliticalBoundaries(await geoResponse.json());
  // Load fill/pickable country polygons WITHOUT Cesium's polygon-outline geometry.
  // Some country rings cross the antimeridian and make subdivideRhumbLine allocate an invalid array.
  countryBorders=await Cesium.GeoJsonDataSource.load(geoJson,{fill:Cesium.Color.fromBytes(25,110,180,12),clampToGround:false});
  countryViewer.dataSources.add(countryBorders);
  countryBorders.entities.values.forEach(e=>{if(e.polygon){e.polygon.material=Cesium.Color.fromBytes(25,110,180,12);e.polygon.outline=false;e.polygon.height=0;e.polygon.extrudedHeight=0}});
  // Draw borders separately as non-subdivided polylines; this preserves visible country boundaries
  // without invoking createPolygonOutlineGeometry/subdivideRhumbLine.
  const lineEntities=[];
  const addRing=(ring,feature)=>{if(!Array.isArray(ring)||ring.length<2)return;const coords=[];for(const p of ring){if(!Array.isArray(p)||p.length<2||!Number.isFinite(Number(p[0]))||!Number.isFinite(Number(p[1])))continue;coords.push(Number(p[0]),Math.max(-89.9999,Math.min(89.9999,Number(p[1]))))}if(coords.length>=4){lineEntities.push({name:'country-border',polyline:{positions:Cesium.Cartesian3.fromDegreesArray(coords),width:1.15,material:Cesium.Color.fromBytes(85,205,255,205),arcType:Cesium.ArcType.NONE},properties:{countryBorder:true}})}};
  for(const feature of (geoJson.features||[])){const g=feature.geometry;if(!g)continue;if(g.type==='Polygon'){(g.coordinates||[]).forEach(ring=>addRing(ring,feature))}else if(g.type==='MultiPolygon'){(g.coordinates||[]).forEach(poly=>poly.forEach(ring=>addRing(ring,feature)))}}
  const borderLines=new Cesium.CustomDataSource('country-border-lines');borderLines.entities.suspendEvents();lineEntities.forEach(e=>borderLines.entities.add(e));borderLines.entities.resumeEvents();countryViewer.dataSources.add(borderLines);loadAnimatedInlandWaters(countryViewer);
  const handler=countryViewer.screenSpaceEventHandler;
  handler.setInputAction(m=>{const picked=countryViewer.scene.pick(m.position);const entity=picked?.id;if(!entity)return;const code=countryCodeOf(entity);if(code&&chooseCountry(code,false)){countryViewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(Number(s.selectedOptions[0].dataset.lon),Number(s.selectedOptions[0].dataset.lat),2800000),duration:.65})}else if(code){$('#country-pick-status').textContent='Страна '+code+' отсутствует в доступном списке или уже занята. Выбери другую страну.'}},Cesium.ScreenSpaceEventType.LEFT_CLICK);
  countryViewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(10,15,22000000)});
 }catch(e){console.error('Country globe failed',e);$('#country-pick-status').textContent='Не удалось загрузить границы стран. Можно пока выбрать страну из списка.'}}
 if(!spawnMap&&window.L){spawnMap=L.map('spawn-map').setView([20,0],2);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(spawnMap);spawnMarker=L.marker([20,0]).addTo(spawnMap);spawnMap.on('click',e=>{const lat=e.latlng.lat,lon=e.latlng.lng;$('#spawn-lat').value=lat.toFixed(4);$('#spawn-lon').value=lon.toFixed(4);spawnMarker.setLatLng([lat,lon])});const sync=()=>{const lat=Number($('#spawn-lat').value)||0,lon=Number($('#spawn-lon').value)||0;spawnMarker.setLatLng([lat,lon]);spawnMap.setView([lat,lon],Math.max(spawnMap.getZoom(),5))};$('#spawn-lat').onchange=sync;$('#spawn-lon').onchange=sync}else if(spawnMap){setTimeout(()=>spawnMap.invalidateSize(),100)}
 const first=[...s.options].find(o=>!o.disabled);if(first){s.value=first.value;chooseCountry(first.value,false)}
 setTimeout(()=>{if(countryViewer)countryViewer.resize();if(spawnMap)spawnMap.invalidateSize()},250)
}
function countryCodeOf(entity){const props=entity?.properties;if(!props)return null;for(const key of ['ISO3166-1-Alpha-2','ISO_A2','iso_a2','ISO2','ISO3166_1_Alpha_2']){try{const v=props[key]?.getValue?.();if(v&&String(v).length===2&&String(v)!=='-99')return String(v).toUpperCase()}catch(e){}}try{const n=props.name?.getValue?.()||props.ADMIN?.getValue?.()||entity.name;const found=countries.find(c=>c[1].toLowerCase()===String(n||'').toLowerCase());return found?.[0]||null}catch(e){return null}}
$('#claim-country').onclick=async()=>{try{await api('/api/countries/claim',{method:'POST',body:JSON.stringify({country_code:$('#country-select').value,spawn_lat:Number($('#spawn-lat').value),spawn_lon:Number($('#spawn-lon').value)})});const d=await api('/api/auth/me');user=d.user;showGame()}catch(e){$('#country-error').textContent=e.message}};
$('#logout').onclick=()=>{token='';localStorage.removeItem('wg_token');if(socket)socket.close();showAuth()};
let cesiumIonReady=false;
async function configureCesiumWorld(v,cfg={}){let ionToken=cfg.cesiumToken||localStorage.getItem('wg_cesium_token')||localStorage.getItem('cesium_ion_token')||'';if(!ionToken&&cfg.cesiumTokenProvisioning&&token){try{const issued=await api('/api/cesium/token',{method:'POST'});ionToken=issued.token||'';if(ionToken)localStorage.setItem('wg_cesium_token',ionToken)}catch(e){console.warn('Cesium token provisioning failed:',e)}}if(ionToken){Cesium.Ion.defaultAccessToken=ionToken;try{v.terrainProvider=await Cesium.CesiumTerrainProvider.fromIonAssetId(1,{requestWaterMask:true,requestVertexNormals:true});v.scene.globe.depthTestAgainstTerrain=true;cesiumIonReady=true;console.info('Cesium World Terrain enabled')}catch(e){cesiumIonReady=false;console.warn('Cesium World Terrain unavailable; check token and ion asset access:',e)}try{if(!Cesium.IonImageryProvider?.fromAssetId)throw new Error('Ion imagery provider unavailable');const imagery=await Cesium.IonImageryProvider.fromAssetId(2);v.imageryLayers.removeAll();v.imageryLayers.addImageryProvider(imagery);console.info('Cesium ion imagery enabled')}catch(e){console.warn('Cesium ion imagery unavailable; using satellite proxy:',e);v.imageryLayers.removeAll();v.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:'/api/imagery/{z}/{y}/{x}',maximumLevel:19,credit:'Satellite imagery'}))}}else{cesiumIonReady=false;v.terrainProvider=new Cesium.EllipsoidTerrainProvider();v.imageryLayers.removeAll();v.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:'/api/imagery/{z}/{y}/{x}',maximumLevel:19,credit:'Satellite imagery'}));console.warn('No Cesium ion token: terrain is ellipsoid only; configure CESIUM_ION_TOKEN in Render')}return cesiumIonReady;}
async function initGlobe(){if(viewer){viewer.destroy();viewer=null}try{const cfg=await fetch('/api/config').then(r=>r.json());openWeatherEnabled=!!cfg.openWeatherConfigured;viewer=new Cesium.Viewer('cesiumContainer',{animation:false,timeline:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,terrainProvider:new Cesium.EllipsoidTerrainProvider(),baseLayer:false,requestRenderMode:false});viewer.scene.globe.depthTestAgainstTerrain=true;viewer.scene.globe.enableLighting=true;viewer.scene.globe.showWaterEffect=true;viewer.scene.globe.enableLighting=true;viewer.scene.globe.material=undefined;await configureCesiumWorld(viewer,cfg);await loadGlobalOsmBuildings();viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(position.lon,position.lat,22000000)});loadBorders();loadAnimatedInlandWaters(viewer);viewer.screenSpaceEventHandler.setInputAction(m=>{const p=viewer.camera.pickEllipsoid(m.position,viewer.scene.globe.ellipsoid);if(!p)return;const c=Cesium.Cartographic.fromCartesian(p);const lat=Cesium.Math.toDegrees(c.latitude),lon=Cesium.Math.toDegrees(c.longitude);if(flightRouteMode){setFlightPoint(flightPickTarget,{lat,lon,label:lat.toFixed(4)+'°, '+lon.toFixed(4)+'°'});return}if(mode==='human'&&!user.country_code){$('#spawn-lat').value=lat.toFixed(4);$('#spawn-lon').value=lon.toFixed(4)}else{destination={lat,lon};$('#route-destination').textContent=lat.toFixed(3)+'°, '+lon.toFixed(3)+'°';toast('Пункт назначения выбран')}},Cesium.ScreenSpaceEventType.LEFT_CLICK);initMiniMap();if(user.position)position={...position,...user.position};if(user.spawn){position.lat=user.spawn.lat;position.lon=user.spawn.lon}await updateGroundAndCamera(true);refreshPlayers();}catch(e){console.error(e);toast('Глобус не загрузился. Проверьте Cesium и токен в Render.')}}
const inlandWaterLayers=new WeakMap();
let worldGameWaterMaterialRegistered=false;
function ensureWorldGameWaterMaterial(){if(worldGameWaterMaterialRegistered)return;const type='WorldGameAnimatedWater';Cesium.Material._materialCache.addMaterial(type,{fabric:{type,uniforms:{time:0.0,baseColor:new Cesium.Color(0.025,0.32,0.48,0.72)},source:`
czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    float t = time;
    float waveA = sin((st.x * 52.0 + st.y * 19.0) - t * 1.8 + sin(st.y * 27.0 + t) * 0.8);
    float waveB = sin((st.y * 71.0 - st.x * 24.0) - t * 1.35);
    float waveC = sin((st.x + st.y) * 115.0 + t * 1.15);
    float crest = smoothstep(0.55, 0.96, waveA * 0.52 + waveB * 0.36 + waveC * 0.12);
    float shade = 0.78 + 0.18 * waveA + 0.08 * waveB;
    vec3 deep = baseColor.rgb * shade;
    vec3 glint = vec3(0.28, 0.72, 0.82);
    material.diffuse = mix(deep, glint, crest * 0.48);
    material.alpha = baseColor.a + crest * 0.10;
    material.normal = normalize(vec3((waveA-waveB)*0.10, (waveB-waveC)*0.10, 1.0));
    return material;
}`},translucent:function(){return true;}});worldGameWaterMaterialRegistered=true}
class WorldGameAnimatedWaterProperty{
constructor(){ensureWorldGameWaterMaterial();this.definitionChanged=new Cesium.Event();this.isConstant=false}
getType(){return 'WorldGameAnimatedWater'}
getValue(time,result){result=result||{};result.time=Cesium.JulianDate.toDate(time).getTime()/1000;result.baseColor=new Cesium.Color(0.025,0.32,0.48,0.72);return result}
equals(other){return this===other}
}
const targetWaterPrimitives=new WeakMap();
function targetWaterCenter(coords){const ring=coords?.[0];if(!Array.isArray(ring)||!ring.length)return null;let lon=0,lat=0,n=0;for(const p of ring){if(Array.isArray(p)&&Number.isFinite(+p[0])&&Number.isFinite(+p[1])){lon+=+p[0];lat+=+p[1];n++}}return n?{lon:lon/n,lat:lat/n}:null}
function isDeadSeaOrGalilee(coords){const c=targetWaterCenter(coords);return !!c&&((c.lat>30.75&&c.lat<31.95&&c.lon>35.25&&c.lon<35.8)||(c.lat>32.62&&c.lat<33.03&&c.lon>35.35&&c.lon<35.78))}
function addRealWaterPrimitive(v,name,lonLatRing,height,baseColor){const positions=Cesium.Cartesian3.fromDegreesArrayHeights(lonLatRing.flatMap(p=>[p[0],p[1],height]));const geometry=new Cesium.PolygonGeometry({polygonHierarchy:new Cesium.PolygonHierarchy(positions),perPositionHeight:true,vertexFormat:Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT});const material=Cesium.Material.fromType(Cesium.Material.WaterType,{baseWaterColor:baseColor,blendColor:new Cesium.Color(0.025,0.23,0.36,1),normalMap:Cesium.buildModuleUrl('Assets/Textures/waterNormals.jpg'),frequency:6500,animationSpeed:0.025,amplitude:1.8,specularIntensity:0.85});const primitive=new Cesium.Primitive({geometryInstances:new Cesium.GeometryInstance({geometry,id:name}),appearance:new Cesium.EllipsoidSurfaceAppearance({material,aboveGround:false,translucent:false}),asynchronous:true,releaseGeometryInstances:true});v.scene.primitives.add(primitive);return primitive}
function addTargetSeas(v){if(!v||v.isDestroyed?.())return;const old=targetWaterPrimitives.get(v);if(old)return old;const items=[];const deadSea=[[35.47,31.78],[35.50,31.70],[35.49,31.59],[35.45,31.47],[35.42,31.34],[35.39,31.20],[35.37,31.08],[35.38,30.98],[35.43,30.89],[35.49,30.86],[35.54,30.91],[35.56,31.02],[35.54,31.15],[35.56,31.29],[35.59,31.43],[35.61,31.57],[35.61,31.68],[35.58,31.77]];const galilee=[[35.51,32.88],[35.54,32.89],[35.58,32.86],[35.60,32.82],[35.61,32.77],[35.59,32.73],[35.56,32.70],[35.52,32.70],[35.49,32.73],[35.48,32.78],[35.49,32.83]];try{items.push(addRealWaterPrimitive(v,'Dead Sea animated water',deadSea,-430.5,new Cesium.Color(0.035,0.28,0.39,1)));items.push(addRealWaterPrimitive(v,'Sea of Galilee animated water',galilee,-209,new Cesium.Color(0.025,0.32,0.48,1)));targetWaterPrimitives.set(v,items);return items}catch(e){console.warn('Could not create realistic inland sea water:',e);for(const p of items){try{v.scene.primitives.remove(p)}catch{}}return null}}
async function loadAnimatedInlandWaters(v){if(!v||v.isDestroyed?.())return;const existing=inlandWaterLayers.get(v);if(existing){existing.show=true;addTargetSeas(v);return existing}const ds=new Cesium.CustomDataSource('animated-lakes-and-inland-seas');inlandWaterLayers.set(v,ds);try{const response=await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson');if(!response.ok)throw Error('Lake GeoJSON HTTP '+response.status);const data=await response.json();let count=0;const maxFeatures=4500;const addPoly=coords=>{if(!Array.isArray(coords)||!coords[0]||coords[0].length<4||count>=maxFeatures||isDeadSeaOrGalilee(coords))return;const ring=coords[0];const flat=[];for(const p of ring){if(Array.isArray(p)&&p.length>=2&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1]))&&Math.abs(Number(p[1]))<89.9)flat.push(Number(p[0]),Number(p[1]))}if(flat.length<8)return;const holes=coords.slice(1).map(r=>Cesium.Cartesian3.fromDegreesArray(r.flatMap(p=>[Number(p[0]),Number(p[1])]))).filter(h=>h.length>=3);const hierarchy=new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat),holes.map(positions=>new Cesium.PolygonHierarchy(positions)));ds.entities.add({name:'animated-inland-water',polygon:{hierarchy,material:new WorldGameAnimatedWaterProperty(),outline:false,height:0,classificationType:Cesium.ClassificationType.TERRAIN,arcType:Cesium.ArcType.GEODESIC}});count++};for(const f of data.features||[]){if(count>=maxFeatures)break;const g=f.geometry;if(!g)continue;if(g.type==='Polygon')addPoly(g.coordinates);else if(g.type==='MultiPolygon')for(const p of g.coordinates){addPoly(p);if(count>=maxFeatures)break}}await v.dataSources.add(ds);ds.show=true;addTargetSeas(v);console.info('Animated lake surfaces loaded; dedicated Water material applied to Dead Sea and Sea of Galilee:',count);return ds}catch(e){inlandWaterLayers.delete(v);console.warn('Animated inland water overlay unavailable:',e);addTargetSeas(v);return null}}
async function loadBorders(){try{if(borderSource)viewer.dataSources.remove(borderSource,true);const response=await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');if(!response.ok)throw new Error('HTTP '+response.status);const data=filterPoliticalBoundaries(await response.json());borderSource=new Cesium.CustomDataSource('safe-country-border-lines');borderSource.entities.suspendEvents();const addRing=ring=>{if(!Array.isArray(ring)||ring.length<2)return;const coords=[];for(const p of ring){if(!Array.isArray(p)||p.length<2||!Number.isFinite(Number(p[0]))||!Number.isFinite(Number(p[1])))continue;coords.push(Number(p[0]),Math.max(-89.9999,Math.min(89.9999,Number(p[1]))))}if(coords.length>=4)borderSource.entities.add({polyline:{positions:Cesium.Cartesian3.fromDegreesArray(coords),width:1.15,material:Cesium.Color.CYAN.withAlpha(.72),arcType:Cesium.ArcType.NONE}})};for(const f of(data.features||[])){const g=f.geometry;if(!g)continue;if(g.type==='Polygon')(g.coordinates||[]).forEach(addRing);else if(g.type==='MultiPolygon')(g.coordinates||[]).forEach(poly=>poly.forEach(addRing))}borderSource.entities.resumeEvents();viewer.dataSources.add(borderSource);borderSource.show=$('#borders-toggle').classList.contains('active')}catch(e){console.warn('Country borders unavailable',e)}}
async function getNormalizedModelScale(url,targetSize=42){
 if(!url)return 1;
 if(modelScaleCache.has(url))return modelScaleCache.get(url);
 const task=(async()=>{try{
  const response=await fetch(url,{mode:'cors',cache:'force-cache'});if(!response.ok)throw new Error('HTTP '+response.status);
  const buffer=await response.arrayBuffer();const view=new DataView(buffer);
  if(view.byteLength<20||view.getUint32(0,true)!==0x46546c67)throw new Error('Not a GLB file');
  const jsonLength=view.getUint32(12,true);if(jsonLength<2||jsonLength>view.byteLength-20)throw new Error('Invalid GLB JSON chunk');
  const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,jsonLength)).replace(/\0+$/,''));
  let maxExtent=0;
  for(const accessor of(gltf.accessors||[])){if(accessor.type!=='VEC3'||!Array.isArray(accessor.min)||!Array.isArray(accessor.max))continue;const extent=Math.max(...accessor.max.map((v,i)=>Math.abs(Number(v)-Number(accessor.min[i]))));if(Number.isFinite(extent))maxExtent=Math.max(maxExtent,extent)}
  if(!maxExtent)throw new Error('Model has no usable POSITION bounds');
  return Math.max(0.000001,Math.min(100000,targetSize/maxExtent));
 }catch(e){console.warn('Could not normalize GLB size; using fallback scale:',url,e);return 1}})();
 modelScaleCache.set(url,task);return task;
}
function updatePlayerEntity(){
 if(!viewer)return;
 const p=mode==='aircraft'?planes.find(x=>x.id===selectedAircraft):null;
 const uri=p&&p.url?p.url:'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/glTF-Binary/CesiumMan.glb';
 const cart=Cesium.Cartesian3.fromDegrees(position.lon,position.lat,Math.max(0,position.alt||0));
 const hpr=new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(position.heading||0),Cesium.Math.toRadians(position.pitch||0),Cesium.Math.toRadians(position.roll||0));
 const orientation=Cesium.Transforms.headingPitchRollQuaternion(cart,hpr);
 if(!playerEntity||playerEntityUri!==uri){
  if(playerEntity)viewer.entities.remove(playerEntity);
  playerEntityUri=uri;
  playerEntity=viewer.entities.add({id:'world-game-local-player',name:user?.username||'Player',position:cart,orientation,model:{uri,scale:mode==='aircraft'?1:1.7,minimumPixelSize:0,maximumScale:10000},label:{text:user?.username||'Ты',font:'12px sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.BOTTOM,pixelOffset:new Cesium.Cartesian2(0,-38)}});
  if(mode==='aircraft'){const thisEntity=playerEntity;getNormalizedModelScale(uri,42).then(scale=>{if(viewer&&playerEntity===thisEntity&&playerEntityUri===uri){playerEntity.model.scale=scale;viewer.scene.requestRender()}})}
 }else{playerEntity.position=cart;playerEntity.orientation=orientation;playerEntity.label.text=user?.username||'Ты';}
}
async function updateGroundAndCamera(force=false){if(!viewer)return;if(mode==='human'){const now=Date.now();if(force||now-terrainSampleAt>3000){terrainSampleAt=now;try{const carto=Cesium.Cartographic.fromDegrees(position.lon,position.lat);const renderedHeight=viewer.scene.globe.getHeight(carto);if(Number.isFinite(renderedHeight))terrainGroundHeight=Math.max(-500,renderedHeight);else if(!cesiumIonReady)terrainGroundHeight=0}catch(e){console.warn('Rendered terrain height unavailable:',e)}}position.alt=Math.max(0,terrainGroundHeight+1.7)}updatePlayerEntity();const heading=Cesium.Math.toRadians(position.heading||0);if(!freeCamera){if(mode==='aircraft'){const target=Cesium.Cartesian3.fromDegrees(position.lon,position.lat,Math.max(20,position.alt||1000));viewer.camera.lookAt(target,new Cesium.HeadingPitchRange(Cesium.Math.toRadians(position.heading||0)+cameraHeading,cameraPitch,cameraDistance))}else{viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(position.lon,position.lat,terrainGroundHeight+1.7),orientation:{heading:cameraHeading||heading,pitch:cameraPitch,roll:0}})}}viewer.scene.requestRender()}
function initMiniMap(){const el=$('#minimap');if(!el||miniMap)return;miniMap=L.map(el,{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false}).setView([position.lat,position.lon],3);L.tileLayer('/api/imagery/{z}/{y}/{x}',{maxZoom:18,attribution:'Satellite imagery © Esri'} ).addTo(miniMap);fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson').then(r=>{if(!r.ok)throw Error('Country GeoJSON HTTP '+r.status);return r.json()}).then(data=>{L.geoJSON(filterPoliticalBoundaries(data),{style:{color:'#5de5ef',weight:1,opacity:.8,fillOpacity:0,interactive:false}}).addTo(miniMap)}).catch(e=>console.warn('Mini-map country borders unavailable:',e));L.circleMarker([position.lat,position.lon],{radius:5,color:'#65e7d0'}).addTo(miniMap)}
async function setLayer(layer){$$('[data-layer]').forEach(b=>b.classList.toggle('active',b.dataset.layer===layer));if(!viewer)return;try{viewer.imageryLayers.removeAll();if(layer==='satellite'){viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:'/api/imagery/{z}/{y}/{x}',maximumLevel:19,credit:'Satellite imagery'}))}else if(layer==='weather'){if(!openWeatherEnabled){toast('Для температурного слоя добавьте OPENWEATHER_API_KEY в Environment на Render.');layer='terrain';$$('[data-layer]').forEach(b=>b.classList.toggle('active',b.dataset.layer===layer))}if(layer==='weather'){if(cesiumIonReady&&Cesium.IonImageryProvider?.fromAssetId){try{viewer.imageryLayers.addImageryProvider(await Cesium.IonImageryProvider.fromAssetId(2))}catch(e){viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:'/api/imagery/{z}/{y}/{x}',maximumLevel:19,credit:'Satellite imagery'}))}}else viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:'/api/imagery/{z}/{y}/{x}',maximumLevel:19,credit:'Satellite imagery © Esri'}));const temp=viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:'/api/temperature-tiles/{z}/{x}/{y}.png',tilingScheme:new Cesium.WebMercatorTilingScheme(),maximumLevel:18,credit:'OpenWeather temperature'}));temp.alpha=.96;temp.brightness=1.18;temp.contrast=2.25;temp.saturation=1.9;temp.gamma=.82;temp.errorEvent.addEventListener(err=>console.warn('Temperature tile failed:',err))}}if(layer==='terrain'){if(cesiumIonReady&&Cesium.IonImageryProvider?.fromAssetId){try{viewer.imageryLayers.addImageryProvider(await Cesium.IonImageryProvider.fromAssetId(2))}catch(e){viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:'/api/imagery/{z}/{y}/{x}',maximumLevel:19,credit:'Satellite imagery'}))}}else viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',maximumLevel:19,credit:'© OpenStreetMap'}))}viewer.scene.requestRender()}catch(e){console.warn('Map layer switch failed',e);toast('Не удалось загрузить слой карты. Проверь токен и ключ погоды.')}}
$$('[data-layer]').forEach(b=>b.onclick=()=>setLayer(b.dataset.layer));
$('#borders-toggle').onclick=()=>{const active=$('#borders-toggle').classList.toggle('active');$('#show-borders').checked=active;if(borderSource)borderSource.show=active};
$('#show-borders').onchange=e=>{if(borderSource)borderSource.show=e.target.checked;$('#borders-toggle').classList.toggle('active',e.target.checked)};
$('#center-player').onclick=()=>viewer?.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(position.lon,position.lat,Math.max(12000,position.alt+12000)),duration:1});
$('#open-map').onclick=()=>$('#map-panel').classList.toggle('hidden');$('#open-hangar').onclick=()=>$('#hangar-panel').classList.toggle('hidden');$('#time-toggle').onclick=()=>$('#clock-panel').classList.toggle('hidden');
$$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).classList.add('hidden'));
function renderPlanes(){$('#aircraft-list').innerHTML='';planes.forEach(p=>{const el=document.createElement('div');el.className='aircraft-item'+(selectedAircraft===p.id?' selected':'');el.innerHTML='<span class="plane-icon">✈</span><div><b></b><small></small></div><button>Выбрать</button>';el.querySelector('b').textContent=p.name;el.querySelector('small').textContent=p.type;el.querySelector('button').onclick=()=>{selectedAircraft=p.id;renderPlanes();if(mode==='aircraft')updatePlayerEntity();toast('Выбран: '+p.name)};$('#aircraft-list').append(el)})}
$$('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
let freeCamera=false,personKeys=new Set(),cameraHeading=0,cameraPitch=-0.22,cameraDistance=115;
let flightRouteMode=false,flightPickTarget='departure',flightDeparture=null,flightArrival=null,panoramaAudioContext=null,panoramaAudioNodes=[];

async function prepareAircraftMode(){const overlay=$('#world-loading');if(!overlay)return;overlay.classList.remove('hidden');const status=$('#loading-status');if(status)status.textContent='Выбираем панораму планеты и подготавливаем здания и деревья…';const art=$('.loading-art');const lat=(Math.random()*140)-70,lon=(Math.random()*360)-180;if(art){art.style.backgroundImage='';art.style.background='linear-gradient(160deg,#254f70,#b9d6e2 48%,#e5c28d 49%,#153747)'}const model=$('#loading-aircraft-model');if(model){const plane=planes.find(p=>p.id===selectedAircraft)||planes[0];model.setAttribute('src',plane.url);model.setAttribute('alt',plane.name);model.classList.remove('hidden');$('#loading-plane')?.classList.add('hidden')}try{if(viewer){viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(lon,lat,180000),duration:0.01});viewer.scene.requestRender()}await fetchNearbyWorldObjects(true);if(status)status.textContent='Регион подготовлен. Завершаем запуск самолёта…'}catch(e){console.warn('Aircraft preloading:',e);if(status)status.textContent='Некоторые объекты недоступны; продолжаем загрузку.'}finally{setTimeout(()=>{overlay.classList.add('hidden');if(viewer){viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(position.lon,position.lat,Math.max(1200,position.alt*2)),duration:0.4})}},1200)}}
async function setMode(m){if(!['human','aircraft'].includes(m)||mode===m)return;flightRouteMode=false;$('#flight-planner')?.classList.add('hidden');$('#flight-panorama')?.classList.add('hidden');mode=m;$('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));$('#flight-hud').classList.toggle('hidden',m!=='aircraft');if(m==='aircraft'){$('#hangar-panel').classList.remove('hidden');position.alt=Math.max(1000,Number(position.alt)||0);cameraHeading=0;cameraPitch=-0.22;cameraDistance=115;position.throttle=position.throttle??50;toast('Полёт: W/S тангаж · A/D крен · Q/E курс · R/F тяга')}else{position.pitch=0;position.roll=0;position.alt=Math.max(0,terrainGroundHeight+1.7);toast('Персонаж: W/A/S/D движение · Shift — бег')}if(playerEntity){viewer?.entities.remove(playerEntity);playerEntity=null;playerEntityUri=''}updateGroundAndCamera(true).catch(console.warn);renderPlanes()}
$('#start-flight').onclick=()=>{setMode('aircraft');position.alt=Math.max(1000,position.alt);updatePlayerEntity();toast('Полёт начат! W/S — тангаж, A/D — крен, Q/E — курс, R/F — тяга.')};$('#land-flight').onclick=()=>setMode('human');
window.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName||''))return;const k=e.key.toLowerCase();if(['w','a','s','d','q','e','r','f','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(k)){personKeys.add(k);e.preventDefault()}});
const freeCamBtn=document.createElement('button');freeCamBtn.id='free-camera-toggle';freeCamBtn.className='chip';freeCamBtn.type='button';freeCamBtn.textContent='Свободная камера: выкл';$('.toolbar').append(freeCamBtn);freeCamBtn.onclick=()=>{freeCamera=!freeCamera;freeCamBtn.classList.toggle('active',freeCamera);freeCamBtn.textContent='Свободная камера: '+(freeCamera?'вкл':'выкл');toast(freeCamera?'Свободная камера: вращай мышью, колесо — масштаб':'Камера следует за игроком');if(!freeCamera)updateGroundAndCamera(true).catch(console.warn)};

let cameraDragging=false,cameraLastX=0,cameraLastY=0;const canvas=()=>viewer?.scene?.canvas;function onCameraDown(e){if(e.button!==0||e.target.closest('button,input,select,textarea,.panel'))return;cameraDragging=true;cameraLastX=e.clientX;cameraLastY=e.clientY}function onCameraMove(e){if(!cameraDragging)return;const dx=e.clientX-cameraLastX,dy=e.clientY-cameraLastY;cameraLastX=e.clientX;cameraLastY=e.clientY;if(mode==='aircraft'&&!freeCamera){cameraHeading-=dx*.006;cameraPitch=Math.max(-1.05,Math.min(.15,cameraPitch+dy*.004));updateGroundAndCamera(false).catch(console.warn)}else if(freeCamera&&viewer){viewer.camera.rotateLeft(dx*.003);viewer.camera.rotateUp(dy*.003)}}function onCameraUp(){cameraDragging=false}document.addEventListener('pointerdown',onCameraDown);document.addEventListener('pointermove',onCameraMove);document.addEventListener('pointerup',onCameraUp);document.addEventListener('pointercancel',onCameraUp);document.addEventListener('wheel',e=>{if(mode==='aircraft'&&!freeCamera&&viewer){cameraDistance=Math.max(25,Math.min(500,cameraDistance+e.deltaY*.12));updateGroundAndCamera(false).catch(console.warn)}},{passive:true});
window.addEventListener('keyup',e=>personKeys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>personKeys.clear());



/* Global 3D building layer from Cesium ion. This does not depend on Overpass availability. */
let osmBuildingsViewer=null,osmBuildingsLoading=false;
async function loadGlobalOsmBuildings(){
 if(!viewer||osmBuildingsViewer===viewer||osmBuildingsLoading)return;
 if(!cesiumIonReady){console.warn('Cesium OSM Buildings skipped: Cesium ion terrain/token is not ready');return}
 osmBuildingsLoading=true;
 const target=viewer;
 try{
  if(typeof Cesium.createOsmBuildingsAsync!=='function')throw new Error('createOsmBuildingsAsync is not available in this CesiumJS build');
  const tileset=await Cesium.createOsmBuildingsAsync();
  if(target!==viewer){try{target.scene.primitives.remove(tileset)}catch{}return}
  target.scene.primitives.add(tileset);
  osmBuildingsViewer=target;
  console.info('Cesium OSM Buildings loaded: global 3D building tileset');
 }catch(e){console.warn('Cesium OSM Buildings unavailable; check Cesium ion token permissions and asset access:',e?.message||e)}
 finally{osmBuildingsLoading=false}
}

/* Nearby 3D buildings and trees (OpenStreetMap -> Cesium entities).
   Shown in human mode and at aircraft altitudes up to 200 metres. */
const worldPayloadCache = (()=>{let dbPromise=null;function db(){if(!('indexedDB'in window))return Promise.resolve(null);if(!dbPromise)dbPromise=new Promise(resolve=>{const req=indexedDB.open('world-game-world-cache-v1',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('payloads'))req.result.createObjectStore('payloads')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null)});return dbPromise}return {async get(key){try{const d=await db();if(!d)return null;return await new Promise(resolve=>{const r=d.transaction('payloads','readonly').objectStore('payloads').get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>resolve(null)})}catch{return null}},async put(key,value){try{const d=await db();if(!d)return;await new Promise(resolve=>{const tx=d.transaction('payloads','readwrite');tx.objectStore('payloads').put({savedAt:Date.now(),value},key);tx.oncomplete=tx.onerror=()=>resolve()})}catch(e){console.warn('World cache storage unavailable',e)}}}})();
function worldPayloadKey(lat,lon,radius){return [Math.round(lat*500)/500,Math.round(lon*500)/500,Math.round(radius/100)*100].join(':')}
const nearbyWorldObjects = { dataSource:null, fetching:false, lastLat:NaN, lastLon:NaN, lastFetch:0 };
// Keep rendered regions for the whole session so buildings/trees do not vanish on descent or when revisiting a tile.
const nearbyWorldDataSources = new Map();
const nearbyWorldOverpassHosts = [
 'https://overpass-api.de/api/interpreter',
 'https://overpass.kumi.systems/api/interpreter',
 'https://overpass.private.coffee/api/interpreter'
];
function disposeNearbyWorldObjects(){
 if(!viewer||!nearbyWorldObjects.dataSource)return;
 try{viewer.dataSources.remove(nearbyWorldObjects.dataSource,true)}catch(e){console.warn('Could not clear nearby buildings/trees:',e)}
 nearbyWorldObjects.dataSource=null;
}
function worldObjectDistance(a,b){
 const dy=(a.lat-b.lat)*111320;
 const dx=(a.lon-b.lon)*111320*Math.cos((a.lat+b.lat)*Math.PI/360);
 return Math.hypot(dx,dy);
}
function nearbyObjectColor(value,fallback){
 if(typeof value!=='string'||!value.trim())return fallback;
 try{return Cesium.Color.fromCssColorString(value.trim())||fallback}catch{return fallback}
}
function makeTreeEntity(ds,lat,lon,tags,index){
 const height=Math.max(3,Math.min(24,Number.parseFloat(tags.height)||((Number.parseInt(tags.diameter_crown,10)||5)*1.4)));
 const radius=Math.max(1.1,Math.min(5.5,Number.parseFloat(tags.diameter_crown)||2.6));
 const base=Cesium.Cartesian3.fromDegrees(lon,lat,height*.18);
 const treeOrientation=Cesium.Transforms.headingPitchRollQuaternion(base,new Cesium.HeadingPitchRoll(0,0,0));
 const crownColors=[Cesium.Color.fromCssColorString('#2c773d'),Cesium.Color.fromCssColorString('#438b47'),Cesium.Color.fromCssColorString('#5b9a50'),Cesium.Color.fromCssColorString('#347b50')];
 const crown=crownColors[index%crownColors.length];
 ds.entities.add({position:base,orientation:treeOrientation,name:tags.name||'Tree',cylinder:{length:height*.36,topRadius:radius*.12,bottomRadius:radius*.16,material:Cesium.Color.fromCssColorString('#76503b'),outline:false},description:'Дерево по данным OpenStreetMap'});
 const crownBase=Cesium.Cartesian3.fromDegrees(lon,lat,height*.62);
 const crownOrientation=Cesium.Transforms.headingPitchRollQuaternion(crownBase,new Cesium.HeadingPitchRoll(0,0,0));
 const type=tags.leaf_type==='needleleaved'||tags.leaf_type==='evergreen';
 if(type){
  ds.entities.add({position:crownBase,orientation:crownOrientation,name:tags.name||'Evergreen tree',cylinder:{length:height*.72,topRadius:0.12,bottomRadius:radius,material:crown,outline:false}});
 }else{
  ds.entities.add({position:crownBase,orientation:crownOrientation,name:tags.name||'Tree crown',ellipsoid:{radii:new Cesium.Cartesian3(radius,radius,Math.max(radius,height*.28)),material:crown,outline:false}});
 }
}

function pointInForestRing(lat,lon,ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const yi=Number(ring[i]?.lat),xi=Number(ring[i]?.lon),yj=Number(ring[j]?.lat),xj=Number(ring[j]?.lon);
  if(![yi,xi,yj,xj].every(Number.isFinite))continue;
  if(((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/(yj-yi||1e-12)+xi))inside=!inside;
 }
 return inside;
}
function addTreesInsideForest(ds,way,origin,radius,startIndex){
 const ring=way.geometry||[];if(ring.length<4)return 0;
 const latRadius=radius/111320,lonRadius=radius/(111320*Math.max(.2,Math.cos(origin.lat*Math.PI/180)));
 let ringMinLat=Infinity,ringMaxLat=-Infinity,ringMinLon=Infinity,ringMaxLon=-Infinity;
 for(const p of ring){const plat=Number(p?.lat),plon=Number(p?.lon);if(!Number.isFinite(plat)||!Number.isFinite(plon))continue;ringMinLat=Math.min(ringMinLat,plat);ringMaxLat=Math.max(ringMaxLat,plat);ringMinLon=Math.min(ringMinLon,plon);ringMaxLon=Math.max(ringMaxLon,plon)}
 const minLat=Math.max(origin.lat-latRadius,ringMinLat),maxLat=Math.min(origin.lat+latRadius,ringMaxLat);
 const minLon=Math.max(origin.lon-lonRadius,ringMinLon),maxLon=Math.min(origin.lon+lonRadius,ringMaxLon);
 if(!(maxLat>minLat&&maxLon>minLon))return 0;
 const stepLat=Math.max(.00012,(maxLat-minLat)/24),stepLon=Math.max(.00012,(maxLon-minLon)/24);
 let created=0;
 for(let lat=minLat+stepLat*.5;lat<=maxLat&&created<80;lat+=stepLat){
  for(let lon=minLon+stepLon*.5;lon<=maxLon&&created<80;lon+=stepLon){
   if(worldObjectDistance({lat,lon},origin)>radius||!pointInForestRing(lat,lon,ring))continue;
   makeTreeEntity(ds,lat,lon,{leaf_type:'broadleaved',height:6.5+((created*7+startIndex)%8)*1.4},startIndex+created);
   created++;
  }
 }
 return created;
}
function addBuildingFootprint(ds,way,origin,index){
 const points=(way.geometry||[]).filter(p=>Number.isFinite(+p.lat)&&Number.isFinite(+p.lon));
 if(points.length<4)return false;
 // Limit vertex count to keep Cesium responsive in dense city centers.
 const stride=Math.max(1,Math.ceil(points.length/90)),reduced=points.filter((_,i)=>i%stride===0);
 if(reduced.length<3)return false;
 const ring=reduced.map(p=>new Cesium.Cartesian2(
  (+p.lon-origin.lon)*111320*Math.cos(origin.lat*Math.PI/180),
  (+p.lat-origin.lat)*111320
 ));
 const area=ring.reduce((acc,p,i)=>{const n=ring[(i+1)%ring.length];return acc+p.x*n.y-n.x*p.y},0);
 if(Math.abs(area)<3)return false;
 const tags=way.tags||{};
 let height=Number.parseFloat(tags.height);
 if(!Number.isFinite(height)||height<2||height>180)height=Math.max(3,Math.min(120,(Number.parseFloat(tags['building:levels'])||2.5)*3.1));
 const roofColor=nearbyObjectColor(tags['roof:colour'],Cesium.Color.fromCssColorString('#b4a28c'));
 const bodyColor=nearbyObjectColor(tags['building:colour']||tags.colour,
  [Cesium.Color.fromCssColorString('#d5c8b5'),Cesium.Color.fromCssColorString('#c7c4ba'),Cesium.Color.fromCssColorString('#d3d0c6'),Cesium.Color.fromCssColorString('#b9afa0')][index%4]);
 const positions=Cesium.Cartesian3.fromDegreesArray(points.map(p=>[+p.lon,+p.lat]).flat());
 const footprint=ring;
 const hierarchy=new Cesium.PolygonHierarchy(positions);
 ds.entities.add({name:tags.name||tags['building:levels']?String(tags.name||'Building'): 'Building',description:'Источник: OpenStreetMap',polygon:{hierarchy,material:bodyColor.withAlpha(.96),outline:true,outlineColor:Cesium.Color.fromCssColorString('#514c45').withAlpha(.78),height:0,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND,extrudedHeight:height,extrudedHeightReference:Cesium.HeightReference.RELATIVE_TO_GROUND,closeTop:true,closeBottom:true,arcType:Cesium.ArcType.GEODESIC}});
 ds.entities.add({name:(tags.name||'Building')+' roof',description:'Approximate roof surface from OpenStreetMap tags',polygon:{hierarchy,height:height+.05,heightReference:Cesium.HeightReference.RELATIVE_TO_GROUND,material:roofColor,outline:true,outlineColor:Cesium.Color.fromCssColorString('#514c45').withAlpha(.8),arcType:Cesium.ArcType.GEODESIC}});
 return true;
}
async function fetchNearbyWorldObjects(force=false){
 if(!viewer)return;
 const eligible=mode==='human'||mode==='aircraft';
 if(!eligible){/* Keep the last prepared region in memory while climbing; do not pop buildings out during descent. */return}
 const now=Date.now();
 const moved=!Number.isFinite(nearbyWorldObjects.lastLat)||worldObjectDistance({lat:nearbyWorldObjects.lastLat,lon:nearbyWorldObjects.lastLon},position)>220;
 if(!force&&!moved&&now-nearbyWorldObjects.lastFetch<30000)return;
 nearbyWorldObjects.fetching=true;nearbyWorldObjects.lastFetch=now;
 const origin={lat:position.lat,lon:position.lon};
 const radius=mode==='human'?280:Math.max(220,Math.min(900,250+Number(position.alt||0)*2));
 const query='[out:json][timeout:18];(way["building"](around:'+Math.round(radius)+','+origin.lat.toFixed(6)+','+origin.lon.toFixed(6)+');node["natural"="tree"](around:'+Math.round(radius)+','+origin.lat.toFixed(6)+','+origin.lon.toFixed(6)+');way["landuse"="forest"](around:'+Math.round(radius)+','+origin.lat.toFixed(6)+','+origin.lon.toFixed(6)+'););out body geom;';
 try{
  const cacheKey=worldPayloadKey(origin.lat,origin.lon,radius);
  if(nearbyWorldDataSources.has(cacheKey)){
   nearbyWorldObjects.dataSource=nearbyWorldDataSources.get(cacheKey);
   nearbyWorldObjects.lastLat=origin.lat;nearbyWorldObjects.lastLon=origin.lon;
   console.info('Nearby world region reused from rendered cache',cacheKey);
   return;
  }
  let payload=await worldPayloadCache.get(cacheKey),lastError=null;
  if(payload?.value&&Array.isArray(payload.value.elements)){payload=payload.value;console.info('World objects restored from local cache',cacheKey)}else payload=null;
  try{
   if(!payload){const response=await fetch('/api/world-objects?lat='+encodeURIComponent(origin.lat)+'&lon='+encodeURIComponent(origin.lon)+'&radius='+encodeURIComponent(Math.round(radius)),{headers:{Accept:'application/json'}});
   if(response.ok){
    const serverPayload=await response.json();
    if(Array.isArray(serverPayload.elements))payload=serverPayload;
    if(payload?.errors?.length)console.warn('World objects server fallback diagnostics:',payload.errors);
   }else console.warn('World objects server proxy returned HTTP',response.status);}
  }catch(e){lastError=e;console.warn('World objects server proxy failed:',e?.message||e)}
  if(!payload||!payload.elements.length){
   for(const host of nearbyWorldOverpassHosts){
    try{
     const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
     try{
      const response=await fetch(host+'?data='+encodeURIComponent(query),{mode:'cors',signal:controller.signal,headers:{Accept:'application/json'}});
      if(!response.ok)throw Error('Overpass HTTP '+response.status);
      const directPayload=await response.json();if(!Array.isArray(directPayload.elements))throw Error('Invalid Overpass response');
      if(directPayload.elements.length){payload=directPayload;break}
      payload=directPayload;
     }finally{clearTimeout(timer)}
    }catch(e){lastError=e;console.warn('Nearby 3D objects source failed:',host,e?.message||e)}
   }
  }
  if(!payload)throw lastError||Error('No Overpass endpoint available');
  if(Array.isArray(payload.elements)&&payload.elements.length)await worldPayloadCache.put(cacheKey,payload);
  const ds=new Cesium.CustomDataSource('nearby-3d-buildings-trees');
  let buildings=0,trees=0;
  const elements=payload.elements||[];
  elements.forEach((item,index)=>{
   const tags=item.tags||{};
   if(item.type==='way'&&tags.building){if(addBuildingFootprint(ds,item,origin,buildings))buildings++}
   else if(item.type==='node'&&tags.natural==='tree'&&Number.isFinite(+item.lat)&&Number.isFinite(+item.lon)){makeTreeEntity(ds,+item.lat,+item.lon,tags,trees++)}
   else if(item.type==='way'&&tags.landuse==='forest'&&Array.isArray(item.geometry)&&item.geometry.length>3){
    trees+=addTreesInsideForest(ds,item,origin,radius,trees);
   }
  });
  if(buildings+trees>0){
   // Do not remove the previous region: it remains rendered while the player climbs, descends or returns.
   await viewer.dataSources.add(ds);ds.show=true;
   nearbyWorldObjects.dataSource=ds;nearbyWorldDataSources.set(cacheKey,ds);
   console.info('Nearby 3D world objects loaded and retained:',{buildings,trees,lat:origin.lat,lon:origin.lon,radius,regionsCached:nearbyWorldDataSources.size});
  }else{console.info('No mapped buildings or trees found in the current radius.')}
  nearbyWorldObjects.lastLat=origin.lat;nearbyWorldObjects.lastLon=origin.lon;
 }catch(e){console.warn('Nearby 3D buildings/trees unavailable:',e?.message||e)}
 finally{nearbyWorldObjects.fetching=false}
}

/* Lightweight road traffic: vehicles are assembled from simple low-poly Cesium boxes,
   and every vehicle advances only along a road geometry returned by OpenStreetMap. */
const trafficState={roads:[],cars:[],lastFetch:0,lastLat:NaN,lastLon:NaN,fetching:false,active:false};
const trafficStyles=[
 {name:'Sedan',body:'#d94d4d',roof:'#f2f4f7'},
 {name:'Hatchback',body:'#4b8fe8',roof:'#e9f4ff'},
 {name:'SUV',body:'#555e6c',roof:'#aeb8c5'},
 {name:'Pickup',body:'#b9854d',roof:'#f0d7b2'},
 {name:'Minivan',body:'#e7e9ec',roof:'#7fc6d8'},
 {name:'Taxi',body:'#f4c542',roof:'#282b30'},
 {name:'Police',body:'#f0f2f5',roof:'#233b68'},
 {name:'Ambulance',body:'#f5f5f5',roof:'#f5f5f5'},
 {name:'Delivery van',body:'#70b87a',roof:'#eaf7eb'},
 {name:'Sports coupe',body:'#a66ae0',roof:'#e7d7f8'}
];
function roadDistance(a,b){const dy=(b.lat-a.lat)*111320,dx=(b.lon-a.lon)*111320*Math.cos((a.lat+b.lat)*Math.PI/360);return Math.hypot(dx,dy)}
function trafficBearing(a,b){return (Math.atan2((b.lon-a.lon)*Math.cos((a.lat+b.lat)*Math.PI/360),b.lat-a.lat)+Math.PI*2)%(Math.PI*2)}
function trafficPointAt(road,distance){
 let d=((distance%road.length)+road.length)%road.length;
 for(let i=0;i<road.segments.length;i++){const seg=road.segments[i];if(d<=seg.length||i===road.segments.length-1){const t=seg.length?Math.max(0,Math.min(1,d/seg.length)):0;return {lat:seg.a.lat+(seg.b.lat-seg.a.lat)*t,lon:seg.a.lon+(seg.b.lon-seg.a.lon)*t,heading:seg.heading}}d-=road.segments[i].length}
 return {lat:road.points[0].lat,lon:road.points[0].lon,heading:0};
}
function trafficOffset(lat,lon,heading,forward,lateral){const north=forward*Math.cos(heading)-lateral*Math.sin(heading),east=forward*Math.sin(heading)+lateral*Math.cos(heading);return {lat:lat+north/111320,lon:lon+east/(111320*Math.max(.15,Math.cos(lat*Math.PI/180)))}}
function trafficEntityPoint(v,offset,height){const p=trafficOffset(v.lat,v.lon,v.heading,offset[1],offset[0]);return Cesium.Cartesian3.fromDegrees(p.lon,p.lat,height+offset[2])}
// Real GLB traffic vehicles. CarConcept is the passenger-car model; the two Cesium
// samples provide additional vehicle silhouettes. Browser HTTP cache reuses downloaded assets.
const trafficModelUris=[
 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/GLB/CarConcept.glb',
 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumMilkTruck/CesiumMilkTruck.glb',
 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/GroundVehicle/GroundVehicle.glb'
];
const trafficModelLoadState=new Map();
function makeTrafficCar(index){
 const style=trafficStyles[index%trafficStyles.length];
 // Mostly passenger cars; keep a few different vehicles for a natural-looking mix.
 const modelIndex=index%7===0?1:index%11===0?2:0;
 const modelUri=trafficModelUris[modelIndex];
 const base=Cesium.Cartesian3.fromDegrees(position.lon,position.lat,2);
 const entity=viewer.entities.add({
  id:'traffic-'+index,
  position:base,
  orientation:Cesium.Transforms.headingPitchRollQuaternion(base,new Cesium.HeadingPitchRoll(0,0,0)),
  model:{
   uri:modelUri,
   scale:modelIndex===0?1:0.72,
   minimumPixelSize:14,
   maximumScale:7,
   runAnimations:true,
   show:true
  }
 });
 if(!trafficModelLoadState.has(modelUri))trafficModelLoadState.set(modelUri,'loading');
 return {style,parts:[{entity,offset:[0,0,0]}],roadIndex:0,distance:0,speed:8+Math.random()*8,last:{lat:position.lat,lon:position.lon,heading:0}};
}
function placeTrafficCar(car,point){
 const cart=Cesium.Cartesian3.fromDegrees(point.lon,point.lat,2);
 // Cesium's local +Y axis points north at heading zero, matching our car's long axis.
 const hpr=new Cesium.HeadingPitchRoll(point.heading+Cesium.Math.PI_OVER_TWO,0,0);
 const orientation=Cesium.Transforms.headingPitchRollQuaternion(cart,hpr);
 let ground=0;
 try{const h=viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(point.lon,point.lat));if(Number.isFinite(h))ground=h}catch{}
 car.last=point;
 car.parts.forEach(({entity,offset})=>{
  entity.position=trafficEntityPoint(point,offset,ground);
  entity.orientation=orientation;
 });
}
function clearTraffic(){trafficState.cars.forEach(c=>c.parts.forEach(p=>viewer?.entities.remove(p.entity)));trafficState.cars=[];trafficState.roads=[];trafficState.active=false;if(viewer)viewer.scene.requestRender()}
async function fetchRoadsDirectFromBrowser(lat,lon,radius){
 const query='[out:json][timeout:4];way(around:'+Math.round(radius)+','+Number(lat).toFixed(6)+','+Number(lon).toFixed(6)+')[highway][highway!~"^(footway|path|steps|pedestrian|cycleway|bridleway|corridor|elevator|proposed|construction)$"];out tags geom;';
 const hosts=['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
 const attempts=hosts.map(async host=>{
  const controller=new AbortController(),timeoutId=setTimeout(()=>controller.abort(),3000);
  try{
   const response=await fetch(host+'?data='+encodeURIComponent(query),{method:'GET',mode:'cors',signal:controller.signal,headers:{'Accept':'application/json'}});
   if(!response.ok)throw Error('HTTP '+response.status);
   const payload=await response.json(),ways=[];
   for(const way of (payload.elements||[])){
    const geometry=way.geometry||[];
    if(geometry.length>=2)ways.push({id:way.id,tags:way.tags||{},geometry:geometry.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon))});
   }
   if(!ways.length)throw Error('empty result');
   return {ways,count:ways.length,source:'OpenStreetMap browser fallback'};
  }finally{clearTimeout(timeoutId)}
 });
 try{return await Promise.any(attempts)}
 catch(e){return {ways:[],count:0,unavailable:true,errors:(e.errors||[]).map(x=>x?.message||String(x))}}
}
async function fetchTrafficRoads(force=false){
 if(!viewer||trafficState.fetching)return;
 const now=Date.now(),moved=!Number.isFinite(trafficState.lastLat)||roadDistance({lat:trafficState.lastLat,lon:trafficState.lastLon},position)>1200;
 if(!force&&(!moved&&now-trafficState.lastFetch<45000))return;
 trafficState.fetching=true;trafficState.lastFetch=now;trafficState.lastLat=position.lat;trafficState.lastLon=position.lon;
 const radius=mode==='aircraft'?Math.max(900,Math.min(3800,1200+position.alt*1.5)):1000;
 try{
  const url='/api/roads?lat='+encodeURIComponent(position.lat)+'&lon='+encodeURIComponent(position.lon)+'&radius='+Math.round(radius);
  const response=await fetch(url,{headers:token?{Authorization:'Bearer '+token}:{}});
  if(!response.ok)throw Error('OSM roads HTTP '+response.status);
  let data=await response.json();
  if(!(data.ways||[]).length||data.fallback){
   console.info('Server returned no local road list (or only a routing fallback); trying direct OpenStreetMap roads.');
   const direct=await fetchRoadsDirectFromBrowser(position.lat,position.lon,radius);
   if((direct.ways||[]).length)data=direct;
   else data.errors=[...(data.errors||[]),...(direct.errors||[])];
  }
  const roads=[];
  // Keep only road segments close to the player's current position. OSRM fallback
  // may return a long route, so spawning cars along the whole geometry puts them far away.
  const localTrafficRadius=data.fallback?3000:(mode==='aircraft'?Math.max(650,Math.min(1800,Number(position.alt)*1.2+650)):650);
  for(const way of (data.ways||[])){
   const pts=(way.geometry||[]).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
   if(pts.length<2)continue;
   const segments=[];let length=0;
   for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i],d=roadDistance(a,b);if(d<1)continue;
    const mid={lat:(a.lat+b.lat)/2,lon:(a.lon+b.lon)/2};
    const near=Math.min(roadDistance(position,a),roadDistance(position,b),roadDistance(position,mid));
    if(near>localTrafficRadius)continue;
    segments.push({a,b,length:d,heading:trafficBearing(a,b)});length+=d;
   }
   if(length>45)roads.push({points:pts,segments,length,highway:way.tags?.highway||'road'});
  }
  if(!roads.length){
   // Do not freeze or remove already visible cars just because a refresh failed.
   if(trafficState.cars.length&&trafficState.roads.length){trafficState.active=true}
   else{trafficState.active=false}
   const detail=(data.errors||[]).join(' | ') || ('Источник='+(data.source||'unknown')+' fallback='+String(!!data.fallback)+'; источники не сообщили подробную ошибку');
   console.warn('ROAD TRAFFIC DIAGNOSTICS', 'count='+String(data.count), 'unavailable='+String(data.unavailable), 'stale='+String(data.stale), 'lat='+position.lat, 'lon='+position.lon, 'radius='+radius, 'serverErrors='+detail);
   return;
  }
  const oldCars=trafficState.cars;oldCars.forEach(c=>c.parts.forEach(p=>viewer?.entities.remove(p.entity)));trafficState.cars=[];trafficState.roads=roads;
  const cap=mode==='aircraft'? (position.alt<=350?30:position.alt<=700?20:12):24;
  for(let i=0;i<cap;i++){const road=roads[Math.floor(Math.random()*roads.length)];if(!road||!road.length)continue;const car=makeTrafficCar(i);car.roadIndex=roads.indexOf(road);car.distance=Math.random()*road.length;trafficState.cars.push(car);placeTrafficCar(car,trafficPointAt(road,car.distance))}
  trafficState.active=true;viewer.scene.requestRender();
 }catch(e){console.warn('Road traffic temporarily unavailable:',e?.message||e);trafficState.lastFetch=Date.now()}finally{trafficState.fetching=false}
}
let trafficLastFrame=0;
function updateRoadTraffic(dt){
 const now=performance.now();
 // The main player loop awaits network requests; use real elapsed time for traffic
 // so vehicles keep moving even when the position API is slow.
 const trafficDt=trafficLastFrame?Math.min(0.25,Math.max(0,(now-trafficLastFrame)/1000)):0.05;
 trafficLastFrame=now;
 const eligible=mode==='human'||(mode==='aircraft'&&Number(position.alt)<=1000);
 if(!viewer||!eligible){if(trafficState.active||trafficState.cars.length)clearTraffic();return}
 if(!trafficState.active){if(Date.now()-trafficState.lastFetch>8000)fetchTrafficRoads().catch(e=>console.warn('Road traffic request failed:',e?.message||e));return}
 if(Date.now()-trafficState.lastFetch>45000&&roadDistance({lat:trafficState.lastLat,lon:trafficState.lastLon},position)>1200)fetchTrafficRoads().catch(console.warn);
 for(const car of trafficState.cars){const road=trafficState.roads[car.roadIndex];if(!road)continue;car.distance=(car.distance+car.speed*trafficDt)%road.length;placeTrafficCar(car,trafficPointAt(road,car.distance))}
 if(viewer) viewer.scene.requestRender();
}

function startMovement(){clearInterval(movementTimer);let last=performance.now();movementTimer=setInterval(async()=>{if(!user||!token)return;const now=performance.now(),dt=Math.min(.05,(now-last)/1000);last=now;const held=k=>personKeys.has(k);updateRoadTraffic(dt);if(mode==='aircraft'){position.pitch=Math.max(-30,Math.min(30,position.pitch+((held('w')?1:0)-(held('s')?1:0))*24*dt));position.roll=Math.max(-65,Math.min(65,position.roll+((held('d')?1:0)-(held('a')?1:0))*55*dt));position.heading=(position.heading+((held('e')?1:0)-(held('q')?1:0))*24*dt+360)%360;position.throttle=Math.max(0,Math.min(100,(position.throttle??50)+((held('r')?1:0)-(held('f')?1:0))*22*dt));const speed=30+(position.throttle||0)*4;position.heading=(position.heading+Math.sin(Cesium.Math.toRadians(position.roll))*Math.max(0,speed-80)/500*dt*180/Math.PI+360)%360;position.alt=Math.max(20,(position.alt||1000)+Math.sin(Cesium.Math.toRadians(position.pitch))*speed/3.6*dt*.8);const rad=Cesium.Math.toRadians(position.heading),distance=speed*1000/3600*dt;position.lat+=Math.cos(rad)*distance/111320;position.lon+=Math.sin(rad)*distance/(111320*Math.max(.15,Math.cos(Cesium.Math.toRadians(position.lat))));position.lon=((position.lon+540)%360)-180;$('#hud-alt').textContent=Math.round(position.alt)+' m';$('#hud-speed').textContent=Math.round(speed)+' km/h';$('#hud-heading').textContent=String(Math.round(position.heading)).padStart(3,'0')+'°';$('#hud-throttle').textContent=Math.round(position.throttle)+'%'}else if(personKeys.size){const heading=freeCamera?Cesium.Math.toDegrees(cameraHeading):(position.heading||0);let forward=(held('w')||held('arrowup')?1:0)-(held('s')||held('arrowdown')?1:0),side=(held('d')||held('arrowright')?1:0)-(held('a')||held('arrowleft')?1:0);const mag=Math.hypot(forward,side)||1,spd=(held('shift')?7:2.4)*dt;forward/=mag;side/=mag;const rad=Cesium.Math.toRadians(heading);position.lat+=(Math.cos(rad)*forward+Math.cos(rad+Math.PI/2)*side)*spd/111320;position.lon+=(Math.sin(rad)*forward+Math.sin(rad+Math.PI/2)*side)*spd/(111320*Math.max(.15,Math.cos(Cesium.Math.toRadians(position.lat))));position.lat=Math.max(-85,Math.min(85,position.lat));position.lon=((position.lon+540)%360)-180;if(!freeCamera)position.heading=heading}await updateGroundAndCamera(false);fetchNearbyWorldObjects(false).catch(e=>console.warn('Nearby 3D objects refresh failed:',e));try{const safe=(v,min,max,fallback=0)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):fallback;position.lat=safe(position.lat,-85,85,20);position.lon=safe(position.lon,-180,180,0);position.alt=safe(position.alt,0,100000,0);position.heading=((safe(position.heading,0,360,0)%360)+360)%360;position.pitch=safe(position.pitch,-90,90,0);position.roll=safe(position.roll,-180,180,0);await api('/api/player/position',{method:'PUT',body:JSON.stringify({lat:position.lat,lon:position.lon,alt:position.alt,mode:mode==='aircraft'?'aircraft':'human',aircraft:mode==='aircraft'?String(selectedAircraft||'airbus-a320'):'human',heading:position.heading,pitch:position.pitch,roll:position.roll})})}catch(e){console.warn('Position update rejected:',e?.message||e)}$('#location-label').textContent=position.lat.toFixed(4)+'°, '+position.lon.toFixed(4)+'°';if(miniMap){miniMap.setView([position.lat,position.lon],Math.max(3,miniMap.getZoom()));miniMap.eachLayer(l=>{if(l instanceof L.CircleMarker)l.setLatLng([position.lat,position.lon])})}},50)}
function stopFlight(){mode='human';$('#flight-hud').classList.add('hidden')}
async function updateWeather(){try{const d=await api('/api/weather?lat='+position.lat+'&lon='+position.lon);if(!d.current){$('#weather-desc').textContent=d.message||'Погода временно недоступна';return}const c=d.current||{},codes={0:'Ясно',1:'Преимущественно ясно',2:'Переменная облачность',3:'Пасмурно',45:'Туман',48:'Изморозь',51:'Морось',61:'Дождь',71:'Снег',80:'Ливень',95:'Гроза'};$('#temperature').textContent=Math.round(c.temperature_2m??0)+'°C';$('#weather-desc').textContent=codes[c.weather_code]||'Погодные условия';$('#weather-icon').textContent=c.weather_code>=95?'⛈':c.weather_code>=71?'❄':c.weather_code>=51?'🌧':c.weather_code>=2?'☁':'☀';$('#wind').textContent=Math.round(c.wind_speed_10m||0)+' км/ч';$('#humidity').textContent=(c.relative_humidity_2m??'—')+'%';$('#feels').textContent=Math.round(c.apparent_temperature??0)+'°C';$('#weather-place').textContent=user?.country_code||'рядом';}catch(e){$('#weather-desc').textContent='Погода временно недоступна'}}$('#refresh-weather').onclick=updateWeather;
let clockManualMinutes=null;function getLocationZone(){const chosen=$('#timezone-select').value;if(chosen!=='auto')return chosen;const longitude=Number(position.lon)||0;return longitude>=30&&longitude<60?'Asia/Jerusalem':longitude>=-15&&longitude<30?'Europe/London':longitude>=60&&longitude<90?'Asia/Tashkent':longitude>=90&&longitude<150?'Asia/Tokyo':longitude<-60&&longitude>=-130?'America/Los_Angeles':longitude>=-60&&longitude< -15?'America/Sao_Paulo':'UTC'}function startClock(){clearInterval(clockTimer);const tick=()=>{const zone=getLocationZone(),now=new Date();const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now).split(':').map(Number);const current=parts[0]*60+parts[1],selected=clockManualMinutes===null?current:clockManualMinutes;$('#time-slider').value=String(selected);$('#time-value').textContent=String(Math.floor(selected/60)).padStart(2,'0')+':'+String(selected%60).padStart(2,'0');const shown=new Date(now.getTime()+(selected-current)*60000);$('#local-clock').textContent=new Intl.DateTimeFormat('ru-RU',{timeZone:zone,hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(shown);$('#local-date').textContent=new Intl.DateTimeFormat('ru-RU',{timeZone:zone,dateStyle:'full'}).format(shown)+' · '+zone;if(viewer&&clockManualMinutes!==null){viewer.clock.currentTime=Cesium.JulianDate.fromDate(shown);viewer.scene.requestRender()}};tick();clockTimer=setInterval(tick,1000)}$('#timezone-select').onchange=()=>{clockManualMinutes=null;startClock()};$('#time-slider').oninput=()=>{clockManualMinutes=Number($('#time-slider').value);startClock()};$('#time-now').onclick=()=>{clockManualMinutes=null;startClock()};
async function refreshPlayers(){try{const d=await api('/api/players');const list=d.players||[];$('#online-count').textContent=(list.length+1)+' онлайн';if(viewer){const seen=new Set();list.forEach(p=>{const name=p.username||'Игрок',pos=p.position||p,lat=Number(pos.lat),lon=Number(pos.lon),alt=Number(pos.alt||0);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;seen.add(name);let ent=remoteEntities[name];const plane=planes.find(x=>x.id===p.aircraft);const uri=p.mode==='aircraft'&&plane&&plane.url?plane.url:null;const loc=Cesium.Cartesian3.fromDegrees(lon,lat,alt);if(!ent){ent=viewer.entities.add({name,position:loc,label:{text:name,font:'11px sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:2,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.BOTTOM,pixelOffset:new Cesium.Cartesian2(0,-22)}});remoteEntities[name]=ent}ent.position=loc;if(uri){if(remoteModelUris[name]!==uri){ent.model={uri,scale:1,minimumPixelSize:64,maximumScale:2000};remoteModelUris[name]=uri;const remoteEntity=ent;getNormalizedModelScale(uri,42).then(scale=>{if(viewer&&remoteEntities[name]===remoteEntity&&remoteModelUris[name]===uri&&remoteEntity.model){remoteEntity.model.scale=scale;viewer.scene.requestRender()}})}ent.point=undefined}else{if(remoteModelUris[name]){ent.model=undefined;delete remoteModelUris[name]}ent.point={pixelSize:p.is_ai?9:11,color:p.is_ai?Cesium.Color.ORANGE:Cesium.Color.CYAN,outlineColor:Cesium.Color.WHITE,outlineWidth:2}}});Object.keys(remoteEntities).forEach(name=>{if(!seen.has(name)){viewer.entities.remove(remoteEntities[name]);delete remoteEntities[name];delete remoteModelUris[name]}})}$('#online-list').innerHTML='';if(!list.length){$('#online-list').innerHTML='<p class="muted">Пока никого нет. Ты можешь быть первым!</p>';return}list.forEach(p=>{const row=document.createElement('div');row.className='player-row';row.innerHTML='<span class="player-avatar">♙</span><div><b></b><small></small></div><button>Позвонить</button>';row.querySelector('b').textContent=p.username;row.querySelector('small').textContent=(p.country_code||'Без страны')+' · '+(p.mode==='aircraft'?'✈ полёт':'на земле');if(p.is_ai){row.querySelector('button').textContent='Пригласить';row.querySelector('button').onclick=()=>{$('#invite-status').textContent='ИИ-страна: '+p.username+' — используй кнопку приглашения Groq ниже.';$('#ai-invite').click()}}else{row.querySelector('button').onclick=()=>startCall(p.username)}$('#online-list').append(row)})}catch(e){$('#online-list').innerHTML='<p class="muted">Список игроков недоступен</p>'}}$('#refresh-online').onclick=refreshPlayers;
function connectSocket(){if(socket)socket.close();socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws?token='+encodeURIComponent(token));socket.onmessage=async e=>{let d;try{d=JSON.parse(e.data)}catch{return}if(d.type==='presence'||d.type==='player_position')refreshPlayers();if(d.type==='invite'){if(confirm(d.from+' приглашает тебя: '+d.message+'\nПерейти в его страну?'))toast('Приглашение принято. Напиши игроку, чтобы согласовать встречу.')}if(d.type==='chat'){toast(d.from+': '+d.message);if(String(d.from||'').startsWith('AI ·')&&$('#voice-panel')&&!$('#voice-panel').classList.contains('hidden')&&'speechSynthesis'in window){const utter=new SpeechSynthesisUtterance(String(d.message||''));utter.lang='ru-RU';window.speechSynthesis.speak(utter)}}if(['voice_offer','voice_answer','ice_candidate','voice_leave'].includes(d.type))await handleSignal(d)};socket.onclose=()=>{}}
$('#invite-player').onclick=async()=>{try{const d=await api('/api/invites',{method:'POST',body:JSON.stringify({target:$('#invite-name').value.trim(),message:'Приглашаю тебя ко мне в страну для совместного полёта!'})});$('#invite-status').textContent='Приглашение отправлено.'}catch(e){$('#invite-status').textContent=e.message}};
$('#ai-invite').onclick=async()=>{try{const d=await api('/api/ai/invite',{method:'POST'});$('#invite-status').textContent='ИИ-страна: '+d.reply;toast('Ответ ИИ получен')}catch(e){$('#invite-status').textContent=e.message}};
async function ensurePeer(target){if(peer)return peer;peer=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});if(localStream)localStream.getTracks().forEach(t=>peer.addTrack(t,localStream));peer.ontrack=e=>$('#remote-audio').srcObject=e.streams[0];peer.onicecandidate=e=>{if(e.candidate&&socket?.readyState===1)socket.send(JSON.stringify({type:'ice_candidate',target,payload:e.candidate}))};return peer}
async function startCall(target){if(!localStream){toast('Сначала включи микрофон');$('#voice-panel').classList.remove('hidden');return}try{const p=await ensurePeer(target),offer=await p.createOffer();await p.setLocalDescription(offer);socket.send(JSON.stringify({type:'voice_offer',target,payload:offer}));$('#voice-status').textContent='Звоним игроку '+target+'…'}catch(e){toast('Не удалось начать звонок: '+e.message)}}
async function handleSignal(d){try{if(d.type==='voice_offer'){if($('#voice-panel').classList.contains('hidden')||!localStream){return}const p=await ensurePeer(d.from);await p.setRemoteDescription(d.payload);const a=await p.createAnswer();await p.setLocalDescription(a);socket.send(JSON.stringify({type:'voice_answer',target:d.from,payload:a}));$('#voice-status').textContent='Голосовой звонок: '+d.from}else if(d.type==='voice_answer'&&peer){await peer.setRemoteDescription(d.payload);$('#voice-status').textContent='Голосовой канал подключён'}else if(d.type==='ice_candidate'&&peer&&d.payload)await peer.addIceCandidate(d.payload);else if(d.type==='voice_leave'&&peer){peer.close();peer=null}}catch(e){console.warn('Voice signal',e)}}
$('#voice-enable').onclick=async()=>{try{localStream=await navigator.mediaDevices.getUserMedia({audio:true});$('#voice-status').textContent='Микрофон включён. Соединяемся с игроками, у которых включён голосовой чат…';$('#voice-enable').disabled=true;$('#voice-mute').disabled=false;try{const d=await api('/api/players');for(const p of (d.players||[])){if(!p.is_ai&&p.username&&p.username!==user.username){await startCall(p.username)}}}catch(e){console.warn(e)}}catch(e){$('#voice-status').textContent='Нет доступа к микрофону: '+e.message}};
$('#voice-mute').onclick=()=>{muted=!muted;localStream?.getAudioTracks().forEach(t=>t.enabled=!muted);$('#voice-mute').textContent=muted?'Включить звук':'Выключить звук';};
function makeDraggable(el){const head=el.querySelector('.panel-head');if(!head)return;let sx=0,sy=0,left=0,top=0,drag=false;head.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;drag=true;const r=el.getBoundingClientRect();sx=e.clientX;sy=e.clientY;left=r.left;top=r.top;head.setPointerCapture(e.pointerId);el.style.right='auto';el.style.bottom='auto';el.style.transform='none'});head.addEventListener('pointermove',e=>{if(!drag)return;el.style.left=Math.max(0,Math.min(innerWidth-el.offsetWidth,left+e.clientX-sx))+'px';el.style.top=Math.max(65,Math.min(innerHeight-el.offsetHeight,top+e.clientY-sy))+'px'});head.addEventListener('pointerup',()=>drag=false)}
$$('.draggable').forEach(makeDraggable);
$('#cesiumContainer').addEventListener('pointerdown',()=>{});
async function getCesiumToken(){try{const d=await api('/api/cesium/token',{method:'POST'});if(d.token){Cesium.Ion.defaultAccessToken=d.token;if(viewer){try{viewer.terrainProvider=await Cesium.CesiumTerrainProvider.fromIonAssetId(1)}catch(e){console.warn(e)}}toast(d.shared?'Используется общий Cesium token':'Cesium token создан');} }catch(e){toast(e.message)}}
$('#cesium-token-btn').onclick=getCesiumToken;window.worldGame={getCesiumToken,refreshPlayers,setMode};

/* Optional original ambient loading score (no copied game soundtrack). */
let worldMusicContext=null,worldMusicNodes=[];function toggleWorldMusic(){const btn=$('#loading-music');if(worldMusicContext){worldMusicNodes.forEach(n=>{try{n.stop()}catch{}});worldMusicNodes=[];worldMusicContext.close().catch(()=>{});worldMusicContext=null;if(btn)btn.textContent='♫ Включить атмосферную музыку';return}try{const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)throw Error('Web Audio недоступен');const ctx=new Ctx(),master=ctx.createGain();master.gain.value=.035;master.connect(ctx.destination);[110,164.81,220,329.63].forEach((freq,i)=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=i===0?'sine':'triangle';osc.frequency.value=freq;gain.gain.value=i===0?.32:.10;osc.connect(gain);gain.connect(master);osc.start();worldMusicNodes.push(osc)});worldMusicContext=ctx;if(btn)btn.textContent='♫ Выключить музыку'}catch(e){toast(e.message)}}
$('#loading-music')?.addEventListener('click',toggleWorldMusic);
/* Dedicated route planner: keeps the legacy human/aircraft modes untouched. */
function setFlightPoint(kind,point){const normalized={lat:Number(point.lat),lon:Number(point.lon),label:point.label||Number(point.lat).toFixed(4)+'°, '+Number(point.lon).toFixed(4)+'°'};if(!Number.isFinite(normalized.lat)||!Number.isFinite(normalized.lon)||Math.abs(normalized.lat)>90||Math.abs(normalized.lon)>180){toast('Проверь координаты');return}if(kind==='departure')flightDeparture=normalized;else flightArrival=normalized;const target=kind==='departure'?'#flight-departure-label':'#flight-arrival-label';$(target).textContent=normalized.label;$('#route-destination').textContent=flightArrival?flightArrival.label:'Пункт назначения не выбран';$('#flight-search-results button[data-kind]').forEach(b=>b.classList.toggle('active',b.dataset.kind===kind));if(viewer){const marker=Cesium.Cartesian3.fromDegrees(normalized.lon,normalized.lat,0);viewer.entities.removeById('flight-point-'+kind);viewer.entities.add({id:'flight-point-'+kind,position:marker,point:{pixelSize:kind==='departure'?13:11,color:kind==='departure'?Cesium.Color.LIME:Cesium.Color.CYAN,outlineColor:Cesium.Color.WHITE,outlineWidth:2,heightReference:Cesium.HeightReference.CLAMP_TO_GROUND},label:{text:(kind==='departure'?'Вылет':'Прилёт')+' · '+normalized.label,font:'13px sans-serif',fillColor:Cesium.Color.WHITE,outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,verticalOrigin:Cesium.VerticalOrigin.BOTTOM,pixelOffset:new Cesium.Cartesian2(0,-16)}});viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(normalized.lon,normalized.lat,Math.max(18000,position.alt+12000)),duration:.8})}toast((kind==='departure'?'Точка вылета':'Точка прилёта')+' выбрана')}
function parseFlightCoordinates(value){const m=value.trim().match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);if(!m)return null;const lat=Number(m[1]),lon=Number(m[2]);return Math.abs(lat)<=90&&Math.abs(lon)<=180?{lat,lon,label:lat.toFixed(4)+'°, '+lon.toFixed(4)+'°'}:null}
async function searchFlightPlaces(){const input=$('#flight-global-search'),results=$('#flight-search-results'),query=input.value.trim();if(!query)return;results.replaceChildren();const coords=parseFlightCoordinates(query);if(coords){addFlightSearchResult(coords.label,coords, 'Координаты');return}const button=$('#flight-search-btn');button.disabled=true;button.textContent='Поиск…';try{const url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=7&addressdetails=1&q='+encodeURIComponent(query);const response=await fetch(url,{headers:{Accept:'application/json'}});if(!response.ok)throw Error('Сервис поиска вернул HTTP '+response.status);const data=await response.json();if(!data.length){results.textContent='Ничего не найдено. Попробуй название города, аэропорта или координаты.';return}data.forEach(item=>addFlightSearchResult(item.name||item.display_name,{lat:Number(item.lat),lon:Number(item.lon),label:item.display_name||item.name},item.type||item.class))}catch(e){results.textContent='Поиск не удался. Можно ввести координаты в формате 48.8584, 2.2945.';console.warn('Flight place search failed:',e)}finally{button.disabled=false;button.textContent='Найти'}}
function addFlightSearchResult(title,point,subtitle){const row=document.createElement('button');row.type='button';row.innerHTML='<span></span><small></small>';row.querySelector('span').textContent=title;row.querySelector('small').textContent=subtitle||point.lat.toFixed(4)+', '+point.lon.toFixed(4);row.onclick=()=>setFlightPoint(flightPickTarget,point);$('#flight-search-results').append(row)}
function stopPanoramaMusic(){panoramaAudioNodes.forEach(n=>{try{n.stop()}catch{}});panoramaAudioNodes=[];if(panoramaAudioContext){panoramaAudioContext.close().catch(()=>{});panoramaAudioContext=null}$('#panorama-music').textContent='♫ Включить мелодию'}
function togglePanoramaMusic(){if(panoramaAudioContext){stopPanoramaMusic();return}try{const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)throw Error('Web Audio недоступен');const ctx=new Ctx(),master=ctx.createGain();master.gain.value=.025;master.connect(ctx.destination);const notes=[146.83,174.61,220,261.63,220,174.61,164.81,196];notes.forEach((freq,i)=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=i%3===0?'sine':'triangle';osc.frequency.value=freq;gain.gain.value=.07;osc.connect(gain);gain.connect(master);osc.start(ctx.currentTime+i*1.1);osc.stop(ctx.currentTime+i*1.1+1.05);panoramaAudioNodes.push(osc)});panoramaAudioContext=ctx;$('#panorama-music').textContent='♫ Перезапустить мелодию';ctx.onstatechange=()=>{if(ctx.state==='closed'){panoramaAudioContext=null;panoramaAudioNodes=[]}}}catch(e){toast(e.message)}}
function showFlightPlanner(){flightRouteMode=true;$('#flight-planner').classList.remove('hidden');$('#flight-panorama').classList.add('hidden');$('#map-panel').classList.remove('hidden');$('#hangar-panel').classList.remove('hidden');flightPickTarget=flightDeparture?'arrival':'departure';$('#pick-departure').classList.toggle('active',flightPickTarget==='departure');$('#pick-arrival').classList.toggle('active',flightPickTarget==='arrival');toast('Выбери точку вылета или прилёта: клик по Земле либо глобальный поиск')}
function hideFlightPlanner(){flightRouteMode=false;$('#flight-planner').classList.add('hidden')}
function startFlightPanorama(){if(!flightDeparture||!flightArrival){toast('Сначала выбери обе точки маршрута');return}const plane=planes.find(p=>p.id===selectedAircraft)||planes[0];$('#flight-planner').classList.add('hidden');$('#flight-panorama').classList.remove('hidden');$('#panorama-title').textContent=plane.name;$('#panorama-aircraft-name').textContent=plane.name;$('#panorama-aircraft-model').setAttribute('src',plane.url);$('#panorama-route-label').textContent=flightDeparture.label+'  →  '+flightArrival.label;$('#panorama-location').textContent='Подготовка спутниковых тайлов и 3D-рельефа в районе вылета…';if(viewer){viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(flightDeparture.lon,flightDeparture.lat,Math.max(1800,position.alt||1800)),duration:1.2});viewer.scene.requestRender()}if(!panoramaAudioContext)$('#panorama-music').textContent='♫ Включить мелодию';else $('#panorama-music').textContent='♫ Перезапустить мелодию';}
$('#flight-mode-btn')?.addEventListener('click',showFlightPlanner);$('#close-flight-planner')?.addEventListener('click',hideFlightPlanner);$('#flight-search-btn')?.addEventListener('click',searchFlightPlaces);$('#flight-global-search')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchFlightPlaces()}});$('#pick-departure')?.addEventListener('click',()=>{flightPickTarget='departure';$('#pick-departure').classList.add('active');$('#pick-arrival').classList.remove('active');toast('Нажми на глобус, чтобы выбрать вылет')});$('#pick-arrival')?.addEventListener('click',()=>{flightPickTarget='arrival';$('#pick-arrival').classList.add('active');$('#pick-departure').classList.remove('active');toast('Нажми на глобус, чтобы выбрать прилёт')});$('#flight-clear-route')?.addEventListener('click',()=>{flightDeparture=flightArrival=null;$('#flight-departure-label').textContent='Не выбрана — нажми на глобус или выполни поиск';$('#flight-arrival-label').textContent='Не выбрана — нажми на глобус или выполни поиск';$('#flight-search-results').replaceChildren();if(viewer){viewer.entities.removeById('flight-point-departure');viewer.entities.removeById('flight-point-arrival')}$('#route-destination').textContent='Пункт назначения не выбран'});$('#flight-start-panorama')?.addEventListener('click',startFlightPanorama);$('#panorama-close')?.addEventListener('click',()=>{$('#flight-panorama').classList.add('hidden');$('#flight-planner').classList.remove('hidden')});$('#panorama-return')?.addEventListener('click',()=>{$('#flight-panorama').classList.add('hidden');$('#flight-planner').classList.remove('hidden')});$('#panorama-music')?.addEventListener('click',togglePanoramaMusic);

restore();
})();