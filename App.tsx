
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, Coordinates, StoreInfo } from './types';
import { findNearbyStores, geocodeAddress } from './services/geminiService';
import StoreCard from './components/StoreCard';

// 定义 Google Maps 的类型声明
declare global {
  interface Window {
    google: any;
  }
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    loading: false,
    error: null,
    location: null,
    stores: [],
    rawResponse: ''
  });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [showPanel, setShowPanel] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');
  
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const circleRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const initialized = useRef(false);

  // 初始化地图
  useEffect(() => {
    const initMap = async () => {
      if (!mapContainerRef.current) return;
      
      try {
        const { Map } = await window.google.maps.importLibrary("maps");
        
        mapRef.current = new Map(mapContainerRef.current, {
          center: { lat: 31.2304, lng: 121.4737 }, // 默认上海
          zoom: 13,
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: {
            position: window.google.maps.ControlPosition.RIGHT_BOTTOM
          },
          styles: [
            { "featureType": "poi", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
            { "featureType": "transit", "stylers": [{ "visibility": "off" }] },
            { "featureType": "road", "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
            { "featureType": "administrative", "elementType": "labels", "stylers": [{ "visibility": "simplified" }] }
          ]
        });
      } catch (e) {
        console.error("Map initialization failed", e);
      }
    };

    if (!mapRef.current) {
      initMap();
    }
  }, []);

  // 精准居中算法：考虑 UI 面板的偏移
  const getOffsetCenter = useCallback((lat: number, lng: number) => {
    if (!mapRef.current) return { lat, lng };

    const isMobile = window.innerWidth < 768;
    const projection = mapRef.current.getProjection();
    if (!projection) return { lat, lng };

    const scale = Math.pow(2, mapRef.current.getZoom());
    const worldPoint = projection.fromLatLngToPoint(new window.google.maps.LatLng(lat, lng));

    // 计算像素偏移量
    // 桌面端：左侧面板宽 380px -> 中心点向右偏移 190px
    // 移动端：底部面板高 ~45vh -> 中心点向上偏移 22.5vh
    let offsetX = 0;
    let offsetY = 0;

    if (isMobile) {
      offsetY = (window.innerHeight * 0.22) / scale;
    } else {
      offsetX = -190 / scale;
    }

    const offsetWorldPoint = new window.google.maps.Point(
      worldPoint.x + offsetX,
      worldPoint.y + offsetY
    );

    return projection.fromPointToLatLng(offsetWorldPoint);
  }, []);

  const updateMap = useCallback((center: Coordinates, stores: StoreInfo[]) => {
    if (!mapRef.current) return;

    const targetLatLng = { lat: center.latitude, lng: center.longitude };
    
    // 执行精准居中平滑移动
    mapRef.current.panTo(targetLatLng);
    mapRef.current.setZoom(14);

    // 清除旧标记
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    if (circleRef.current) circleRef.current.setMap(null);
    if (userMarkerRef.current) userMarkerRef.current.setMap(null);

    // 绘制 5km 圆圈
    circleRef.current = new window.google.maps.Circle({
      strokeColor: "#008062",
      strokeOpacity: 0.8,
      strokeWeight: 1,
      fillColor: "#008062",
      fillOpacity: 0.05,
      map: mapRef.current,
      center: targetLatLng,
      radius: 5000,
    });

    // 用户位置标记
    userMarkerRef.current = new window.google.maps.Marker({
      position: targetLatLng,
      map: mapRef.current,
      zIndex: 100,
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#008062",
        fillOpacity: 1,
        strokeWeight: 4,
        strokeColor: "#FFFFFF",
      }
    });

    // 商店标记
    stores.forEach((store, index) => {
      if (store.lat && store.lng) {
        const marker = new window.google.maps.Marker({
          position: { lat: store.lat, lng: store.lng },
          map: mapRef.current,
          title: store.name,
          animation: window.google.maps.Animation.DROP,
          icon: {
            url: "https://upload.wikimedia.org/wikipedia/commons/4/40/7-eleven_logo.svg",
            scaledSize: new window.google.maps.Size(30, 30),
            anchor: new window.google.maps.Point(15, 15)
          }
        });

        const infoWindow = new window.google.maps.InfoWindow({
          content: `
            <div style="padding: 10px; font-family: sans-serif;">
              <div style="font-weight: 900; color: #008062; margin-bottom: 4px;">${store.name}</div>
              <div style="font-size: 11px; color: #666;">${store.address}</div>
            </div>
          `
        });

        marker.addListener("click", () => {
          infoWindow.open(mapRef.current, marker);
        });

        markersRef.current.push(marker);
      }
    });
  }, []);

  const runSearch = useCallback(async (coords: Coordinates) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    setStatusMsg('正在连接 Google Maps 检索 5km 实时数据...');
    
    try {
      const result = await findNearbyStores(coords);
      setState(prev => ({
        ...prev,
        loading: false,
        location: coords,
        stores: result.stores,
        rawResponse: result.text
      }));
      updateMap(coords, result.stores);
      if (result.stores.length > 0) setShowPanel(true);
    } catch (err: any) {
      setState(prev => ({ ...prev, loading: false, error: err.message }));
    } finally {
      setStatusMsg('');
    }
  }, [updateMap]);

  const handleManualSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) return;

    setState(prev => ({ ...prev, loading: true, error: null }));
    setStatusMsg(`正在精准定位: ${searchTerm}...`);
    
    const coords = await geocodeAddress(searchTerm);
    if (coords) {
      runSearch(coords);
    } else {
      setState(prev => ({ ...prev, loading: false, error: "未找到该地点。请尝试输入城市名或具体的建筑名。" }));
      setStatusMsg('');
    }
  };

  const locateUser = useCallback(() => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    setStatusMsg('正在同步您的精准 GPS 信号...');
    
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setSearchTerm('');
        runSearch(coords);
      },
      (err) => {
        setState(prev => ({ 
          ...prev, 
          loading: false, 
          error: "GPS 定位失败。请检查权限或直接在上方搜索框输入位置。" 
        }));
        setStatusMsg('');
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }, [runSearch]);

  useEffect(() => {
    // 等待 Google 对象准备就绪
    const checkGoogle = setInterval(() => {
      if (window.google && window.google.maps && !initialized.current) {
        initialized.current = true;
        locateUser();
        clearInterval(checkGoogle);
      }
    }, 500);
    return () => clearInterval(checkGoogle);
  }, [locateUser]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white flex flex-col antialiased">
      {/* 浮动置顶 Header */}
      <header className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-2xl border-b border-gray-100 px-4 md:px-8 py-3 md:py-4 flex flex-col md:flex-row gap-3 md:gap-6 items-stretch md:items-center justify-between z-[2000] shadow-[0_2px_15px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex h-9 w-9 md:h-11 md:w-11 items-center justify-center rounded-xl bg-white shadow-sm border border-gray-100 p-1.5 transition-transform hover:rotate-6">
            <img src="https://upload.wikimedia.org/wikipedia/commons/4/40/7-eleven_logo.svg" alt="7-Eleven" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-base md:text-xl font-black text-gray-800 tracking-tight uppercase leading-none">711 FINDER</h1>
            <p className="text-[8px] md:text-[9px] text-[#F37021] font-black tracking-[0.2em] uppercase mt-1">Make Life Better</p>
          </div>
        </div>
        
        <div className="flex flex-1 md:max-w-3xl gap-2 items-center">
          <form onSubmit={handleManualSearch} className="relative flex-1 group">
            <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#008062] transition-colors text-xs md:text-sm"></i>
            <input 
              type="text" 
              placeholder="搜索任何地点 (例如: 台北 101, 新宿站, 陆家嘴)..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 md:py-3.5 pl-11 pr-4 text-xs md:text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-[#008062]/10 focus:border-[#008062] focus:bg-white transition-all"
            />
          </form>
          
          <button
            onClick={locateUser}
            className="bg-white hover:bg-gray-50 text-[#008062] border border-gray-100 h-11 w-11 md:h-13 md:w-13 flex items-center justify-center rounded-2xl shadow-sm transition-all active:scale-95 shrink-0"
            title="当前位置"
          >
            <i className="fa-solid fa-location-arrow text-sm md:text-lg"></i>
          </button>
          
          <button
            onClick={() => handleManualSearch()}
            disabled={state.loading || !searchTerm.trim()}
            className="bg-[#008062] hover:bg-[#006b52] text-white h-11 md:h-13 px-4 md:px-8 rounded-2xl font-black shadow-lg transition-all active:scale-95 disabled:opacity-50 text-[10px] md:text-xs uppercase tracking-widest flex items-center gap-2 shrink-0"
          >
            {state.loading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-bolt"></i>}
            <span className="hidden sm:inline">立即搜索</span>
          </button>
        </div>
      </header>

      {/* 地图容器 */}
      <div className="flex-1 relative mt-[112px] md:mt-[84px]">
        <div ref={mapContainerRef} className="absolute inset-0 z-0"></div>

        {/* 状态加载条 */}
        {statusMsg && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[2100] bg-black/80 backdrop-blur-xl text-white px-6 py-2.5 rounded-full text-[10px] md:text-xs font-black tracking-widest animate-pulse flex items-center gap-3 shadow-2xl">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></div>
            {statusMsg}
          </div>
        )}

        {/* 结果侧边栏 / 底部面板 */}
        <div 
          className={`
            absolute z-[1001] transition-all duration-700 ease-[cubic-bezier(0.2,0,0,1)] flex flex-col border border-white/40
            bg-white/90 backdrop-blur-3xl shadow-[0_30px_80px_rgba(0,0,0,0.18)]
            inset-x-3 bottom-3 max-h-[45vh] rounded-[2.5rem]
            md:top-6 md:left-6 md:bottom-6 md:w-[24rem] md:inset-x-auto md:max-h-none
            ${showPanel ? 'translate-y-0 md:translate-x-0 opacity-100' : 'translate-y-[calc(100%+4rem)] md:-translate-x-[calc(100%+6rem)] opacity-0 pointer-events-none'}
          `}
        >
          <div className="p-5 md:p-8 border-b border-gray-100/30 flex justify-between items-center shrink-0">
            <div>
              <h2 className="font-black text-gray-900 flex items-center gap-3 uppercase tracking-tight text-sm md:text-lg">
                <div className="w-1.5 h-6 bg-[#EE2737] rounded-full"></div>
                周边发现
              </h2>
              <p className="text-[9px] md:text-[11px] text-gray-400 font-bold mt-1.5 uppercase tracking-widest flex items-center gap-2">
                <i className="fa-solid fa-bullseye text-[#008062]"></i>
                {state.loading ? '正在检索...' : `5KM 范围内共有 ${state.stores.length} 处`}
              </p>
            </div>
            <button 
              onClick={() => setShowPanel(false)}
              className="bg-gray-100/60 hover:bg-white w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all text-gray-400 shadow-sm border border-white/50"
            >
              <i className="fa-solid fa-chevron-down md:hidden text-sm"></i>
              <i className="fa-solid fa-chevron-left hidden md:block text-sm"></i>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-5 scroll-smooth scrollbar-hide">
            {state.error && (
              <div className="bg-red-50/80 p-5 rounded-3xl border border-red-100 text-red-600 animate-shake">
                <div className="flex items-center gap-2 font-black text-xs mb-2">
                  <i className="fa-solid fa-circle-exclamation"></i>
                  <span>遇到了一点问题</span>
                </div>
                <p className="text-[10px] md:text-xs leading-relaxed font-semibold opacity-80">{state.error}</p>
              </div>
            )}

            {state.loading && (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse flex gap-4 p-5 bg-white/40 rounded-3xl border border-white">
                    <div className="w-12 h-12 bg-gray-200/40 rounded-2xl"></div>
                    <div className="flex-1 space-y-3 py-1">
                      <div className="h-4 bg-gray-200/40 rounded w-4/5"></div>
                      <div className="h-3 bg-gray-200/40 rounded w-3/5"></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!state.loading && state.stores.length === 0 && !state.error && (
              <div className="text-center py-16 md:py-28 px-8 opacity-60">
                <div className="bg-gray-100/50 w-20 h-20 md:w-28 md:h-28 rounded-full flex items-center justify-center mx-auto mb-6 border-[6px] border-white shadow-inner">
                  <i className="fa-solid fa-map-pin text-gray-300 text-3xl md:text-4xl"></i>
                </div>
                <h3 className="text-gray-800 font-black text-xs md:text-sm uppercase tracking-widest">暂无网点</h3>
                <p className="text-gray-400 text-[10px] md:text-xs mt-3 leading-relaxed font-medium">当前 5km 半径内未找到 7-Eleven。请尝试滑动地图或更换搜索区域。</p>
              </div>
            )}

            {!state.loading && state.stores.map((store, idx) => (
              <div key={idx} className="hover:scale-[1.03] active:scale-95 transition-all duration-300 cursor-pointer">
                <StoreCard store={store} userLocation={state.location} />
              </div>
            ))}
          </div>
          
          {state.location && (
            <div className="p-4 md:p-6 bg-gray-50/60 border-t border-gray-100/30 rounded-b-[2.5rem] shrink-0">
              <div className="flex items-center justify-between text-[9px] md:text-[11px] text-gray-400 font-black uppercase tracking-[0.2em]">
                <span className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                  精准坐标
                </span>
                <span className="bg-white/80 border border-gray-100 text-gray-600 px-3 py-1.5 rounded-xl shadow-sm">
                  {state.location.latitude.toFixed(6)}, {state.location.longitude.toFixed(6)}
                </span>
              </div>
            </div>
          )}
        </div>

        {!showPanel && (
          <button 
            onClick={() => setShowPanel(true)}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 md:translate-x-0 md:bottom-auto md:top-8 md:left-8 bg-[#008062] text-white px-8 py-4 rounded-full shadow-2xl z-[1001] hover:bg-[#006b52] transition-all active:scale-90 flex items-center gap-4 font-black text-[10px] md:text-xs uppercase tracking-widest group border-4 border-white/50"
          >
            <i className="fa-solid fa-list-check text-lg group-hover:rotate-12 transition-transform"></i>
            <span>显示网点列表</span>
          </button>
        )}
      </div>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.3s ease-in-out infinite alternate; animation-iteration-count: 2; }
        /* 隐藏地图版权信息中的某些元素以保持 UI 简洁 */
        .gm-style-cc { display: none; }
      `}</style>
    </div>
  );
};

export default App;
