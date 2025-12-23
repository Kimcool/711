
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
  const [mapLoaded, setMapLoaded] = useState(false);
  
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const circleRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const initialized = useRef(false);

  // 动态加载 Google Maps 脚本
  useEffect(() => {
    if (window.google?.maps) {
      setMapLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.API_KEY}&libraries=places&language=zh-CN`;
    script.async = true;
    script.defer = true;
    script.onload = () => setMapLoaded(true);
    script.onerror = () => setState(prev => ({ ...prev, error: "地图加载失败，请检查 API Key 或网络。" }));
    document.head.appendChild(script);
  }, []);

  // 初始化地图实例
  useEffect(() => {
    if (!mapLoaded || !mapContainerRef.current || mapRef.current) return;
    
    mapRef.current = new window.google.maps.Map(mapContainerRef.current, {
      center: { lat: 31.2304, lng: 121.4737 }, // 默认上海
      zoom: 13,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: {
        position: window.google.maps.ControlPosition.RIGHT_BOTTOM
      },
      styles: [
        { "featureType": "poi.business", "stylers": [{ "visibility": "off" }] },
        { "featureType": "transit", "stylers": [{ "visibility": "simplified" }] }
      ]
    });

    // 初始定位
    if (!initialized.current) {
      initialized.current = true;
      locateUser();
    }
  }, [mapLoaded]);

  const updateMap = useCallback((center: Coordinates, stores: StoreInfo[]) => {
    if (!mapRef.current) return;

    const targetLatLng = { lat: center.latitude, lng: center.longitude };
    
    // 执行精准居中（平滑移动）
    mapRef.current.panTo(targetLatLng);
    mapRef.current.setZoom(14.5);

    // 清除旧图层
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    if (circleRef.current) circleRef.current.setMap(null);
    if (userMarkerRef.current) userMarkerRef.current.setMap(null);

    // 绘制 5km 范围圈
    circleRef.current = new window.google.maps.Circle({
      strokeColor: "#008062",
      strokeOpacity: 0.6,
      strokeWeight: 1,
      fillColor: "#008062",
      fillOpacity: 0.03,
      map: mapRef.current,
      center: targetLatLng,
      radius: 5000,
    });

    // 当前位置标记
    userMarkerRef.current = new window.google.maps.Marker({
      position: targetLatLng,
      map: mapRef.current,
      zIndex: 100,
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#008062",
        fillOpacity: 1,
        strokeWeight: 3,
        strokeColor: "#FFFFFF",
      }
    });

    // 渲染商店标记
    stores.forEach((store, index) => {
      if (store.lat && store.lng) {
        const marker = new window.google.maps.Marker({
          position: { lat: store.lat, lng: store.lng },
          map: mapRef.current,
          title: store.name,
          animation: window.google.maps.Animation.DROP,
          icon: {
            url: "https://upload.wikimedia.org/wikipedia/commons/4/40/7-eleven_logo.svg",
            scaledSize: new window.google.maps.Size(28, 28),
            anchor: new window.google.maps.Point(14, 14)
          }
        });

        const infoWindow = new window.google.maps.InfoWindow({
          content: `
            <div style="padding: 12px; font-family: 'Inter', sans-serif; max-width: 200px;">
              <div style="font-weight: 900; color: #008062; font-size: 14px; margin-bottom: 4px;">${store.name}</div>
              <div style="font-size: 11px; color: #666; line-height: 1.4;">${store.address}</div>
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
    setStatusMsg('正在通过 Google Maps 检索 5km 实时数据...');
    
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
    setStatusMsg(`定位中: ${searchTerm}...`);
    
    const coords = await geocodeAddress(searchTerm);
    if (coords) {
      runSearch(coords);
    } else {
      setState(prev => ({ ...prev, loading: false, error: "未找到该地点，请尝试更具体的名称。" }));
      setStatusMsg('');
    }
  };

  const locateUser = useCallback(() => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    setStatusMsg('正在同步精准 GPS 信号...');
    
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
          error: "GPS 定位失败。请确保浏览器已授权访问位置，或手动输入搜索。" 
        }));
        setStatusMsg('');
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }, [runSearch]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#f3f4f6] flex flex-col antialiased">
      {/* 悬浮 Header */}
      <header className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-3xl border-b border-gray-100 px-4 md:px-8 py-3 md:py-4 flex flex-col md:flex-row gap-3 md:gap-6 items-stretch md:items-center justify-between z-[2000] shadow-sm">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex h-9 w-9 md:h-11 md:w-11 items-center justify-center rounded-xl bg-white shadow-sm border border-gray-100 p-1.5">
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
              placeholder="搜索任何地点..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 md:py-3.5 pl-11 pr-4 text-xs md:text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-[#008062]/10 focus:border-[#008062] transition-all"
            />
          </form>
          
          <button
            onClick={locateUser}
            className="bg-white hover:bg-gray-50 text-[#008062] border border-gray-100 h-11 w-11 md:h-13 md:w-13 flex items-center justify-center rounded-2xl shadow-sm transition-all active:scale-95 shrink-0"
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

      {/* 地图容器区域 */}
      <div className="flex-1 relative mt-[112px] md:mt-[84px]">
        <div ref={mapContainerRef} className="absolute inset-0 z-0"></div>

        {/* 状态提示 */}
        {statusMsg && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[2100] bg-black/80 backdrop-blur-xl text-white px-6 py-2.5 rounded-full text-[10px] md:text-xs font-black tracking-widest animate-pulse flex items-center gap-3 shadow-2xl">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></div>
            {statusMsg}
          </div>
        )}

        {/* 信息面板 */}
        <div 
          className={`
            absolute z-[1001] transition-all duration-700 ease-[cubic-bezier(0.2,0,0,1)] flex flex-col border border-white/40
            bg-white/90 backdrop-blur-3xl shadow-[0_30px_80px_rgba(0,0,0,0.18)]
            inset-x-3 bottom-3 max-h-[46vh] rounded-[2.5rem]
            md:top-6 md:left-6 md:bottom-6 md:w-[24rem] md:inset-x-auto md:max-h-none
            ${showPanel ? 'translate-y-0 md:translate-x-0 opacity-100' : 'translate-y-[calc(100%+4rem)] md:-translate-x-[calc(100%+6rem)] opacity-0 pointer-events-none'}
          `}
        >
          <div className="p-5 md:p-8 border-b border-gray-100/30 flex justify-between items-center shrink-0">
            <div>
              <h2 className="font-black text-gray-900 flex items-center gap-3 uppercase tracking-tight text-sm md:text-lg">
                <div className="w-1.5 h-6 bg-[#EE2737] rounded-full"></div>
                周边网点
              </h2>
              <p className="text-[9px] md:text-[11px] text-gray-400 font-bold mt-1.5 uppercase tracking-widest flex items-center gap-2">
                <i className="fa-solid fa-bullseye text-[#008062]"></i>
                {state.loading ? '检索中...' : `5KM 范围内发现 ${state.stores.length} 家`}
              </p>
            </div>
            <button 
              onClick={() => setShowPanel(false)}
              className="bg-gray-100/60 hover:bg-white w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all text-gray-400"
            >
              <i className="fa-solid fa-chevron-down md:hidden text-sm"></i>
              <i className="fa-solid fa-chevron-left hidden md:block text-sm"></i>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-5 scroll-smooth scrollbar-hide">
            {state.error && (
              <div className="bg-red-50/80 p-5 rounded-3xl border border-red-100 text-red-600">
                <p className="text-[10px] md:text-xs font-semibold">{state.error}</p>
              </div>
            )}

            {state.loading && (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse h-24 bg-gray-200/40 rounded-3xl"></div>
                ))}
              </div>
            )}

            {!state.loading && state.stores.map((store, idx) => (
              <StoreCard key={idx} store={store} userLocation={state.location} />
            ))}
          </div>
          
          {state.location && (
            <div className="p-4 md:p-6 bg-gray-50/60 border-t border-gray-100/30 rounded-b-[2.5rem] shrink-0">
              <div className="flex items-center justify-between text-[9px] md:text-[11px] text-gray-400 font-black uppercase tracking-[0.2em]">
                <span>精准坐标</span>
                <span className="bg-white/80 border border-gray-100 text-gray-600 px-3 py-1.5 rounded-xl">
                  {state.location.latitude.toFixed(6)}, {state.location.longitude.toFixed(6)}
                </span>
              </div>
            </div>
          )}
        </div>

        {!showPanel && (
          <button 
            onClick={() => setShowPanel(true)}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-[#008062] text-white px-8 py-4 rounded-full shadow-2xl z-[1001] font-black text-xs uppercase tracking-widest"
          >
            显示网点列表
          </button>
        )}
      </div>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .gm-style-cc { display: none; }
      `}</style>
    </div>
  );
};

export default App;
