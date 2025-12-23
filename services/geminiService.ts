
import { GoogleGenAI, Type } from "@google/genai";
import { Coordinates, StoreInfo } from "../types";

export const geocodeAddress = async (address: string): Promise<Coordinates | null> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Find the precise GPS coordinates (latitude and longitude) for: "${address}". 
      Return the result strictly as a JSON object with "latitude" and "longitude" keys.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            latitude: { type: Type.NUMBER },
            longitude: { type: Type.NUMBER }
          },
          required: ["latitude", "longitude"]
        }
      }
    });

    const data = JSON.parse(response.text || "{}");
    if (data.latitude && data.longitude) {
      return { latitude: data.latitude, longitude: data.longitude };
    }
    return null;
  } catch (error) {
    console.error("Geocoding failed:", error);
    return null;
  }
};

export const findNearbyStores = async (coords: Coordinates): Promise<{ text: string; stores: StoreInfo[] }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `你是一个专业的地理位置助手。请在坐标 (${coords.latitude}, ${coords.longitude}) 为中心的 5km 半径范围内寻找所有的 7-Eleven 便利店。
  
  要求：
  1. 仅查找 7-Eleven 商店。
  2. 对于找到的每个商店，必须提供精确的名称、详细地址以及准确的经纬度。
  3. 结果请包含以下特定格式的行：
     [DATA] 商店名称 | 详细地址 | 纬度 | 经度
  
  示例：[DATA] 7-Eleven 银座七丁目店 | 东京都中央区银座 7-7-1 | 35.6698 | 139.7615`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: coords.latitude,
              longitude: coords.longitude
            }
          }
        }
      },
    });

    const text = response.text || "";
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    
    // 1. 优先解析 AI 生成的结构化数据
    const storeLines = text.split('\n').filter(line => line.includes('[DATA]'));
    const parsedStores: StoreInfo[] = storeLines.map(line => {
      const parts = line.split('[DATA]')[1].split('|').map(p => p.trim());
      return {
        name: parts[0] || "7-Eleven",
        address: parts[1] || "点击查看详情",
        lat: parseFloat(parts[2]),
        lng: parseFloat(parts[3])
      };
    }).filter(s => !isNaN(s.lat!) && !isNaN(s.lng!));

    // 2. 结合 Google Maps 的 Grounding 数据进行校验和补全
    let finalStores = parsedStores;

    if (groundingChunks.length > 0) {
      const mapsData = groundingChunks
        .filter((chunk: any) => chunk.maps)
        .map((chunk: any) => ({
          name: chunk.maps.title,
          uri: chunk.maps.uri,
          // 如果 Grounding 本身不带坐标，我们至少记录 URI
        }));

      // 尝试匹配 AI 解析出的坐标点与 Grounding 的 URI
      finalStores = finalStores.map(store => {
        const match = mapsData.find(m => 
          store.name.toLowerCase().includes(m.name.toLowerCase()) || 
          m.name.toLowerCase().includes(store.name.toLowerCase())
        );
        return { ...store, uri: match?.uri };
      });

      // 如果 AI 没有解析出任何坐标，但 Grounding 有数据，尝试使用 Grounding 的数据（虽然通常 Grounding URI 指向网页）
      if (finalStores.length === 0) {
        finalStores = mapsData.map(m => ({
          name: m.name,
          address: "点击地图获取位置",
          uri: m.uri,
          // 此时没有坐标，但在 App.tsx 中由于没有 lat/lng 不会渲染 Marker
        }));
      }
    }

    return { text, stores: finalStores };
  } catch (error: any) {
    throw new Error(error.message || "获取商店数据失败。");
  }
};
