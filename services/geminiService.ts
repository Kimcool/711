
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
  
  const prompt = `Find all 7-Eleven convenience stores within exactly a 5km radius of the coordinates: ${coords.latitude}, ${coords.longitude}. 
  Focus ONLY on 7-Eleven stores. 
  
  IMPORTANT: For EVERY store you list, you MUST strictly include its coordinates in this exact line format:
  [DATA] Name | Address | Latitude | Longitude
  
  Example: [DATA] 7-Eleven Ginza 7-Chome | 7-7-1 Ginza, Chuo City, Tokyo | 35.6698 | 139.7615`;

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
    
    const storeLines = text.split('\n').filter(line => line.includes('[DATA]'));
    const parsedStores: StoreInfo[] = storeLines.map(line => {
      const content = line.split('[DATA]')[1].trim();
      const parts = content.split('|').map(p => p.trim());
      return {
        name: parts[0] || "7-Eleven",
        address: parts[1] || "点击地图查看详情",
        lat: parseFloat(parts[2]),
        lng: parseFloat(parts[3])
      };
    }).filter(s => !isNaN(s.lat!) && !isNaN(s.lng!));

    let finalStores = parsedStores;
    if (finalStores.length === 0 && groundingChunks.length > 0) {
      finalStores = groundingChunks
        .filter((chunk: any) => chunk.maps)
        .map((chunk: any) => ({
          name: chunk.maps.title || "7-Eleven",
          address: "点击查看路线",
          uri: chunk.maps.uri,
          lat: coords.latitude + (Math.random() - 0.5) * 0.01, // Rough fallback if coordinates missing
          lng: coords.longitude + (Math.random() - 0.5) * 0.01
        }));
    } else {
      finalStores = parsedStores.map(ps => {
        const match = groundingChunks.find((chunk: any) => 
          chunk.maps && (
            ps.name.toLowerCase().includes(chunk.maps.title.toLowerCase()) || 
            chunk.maps.title.toLowerCase().includes(ps.name.toLowerCase())
          )
        );
        return { ...ps, uri: match?.maps?.uri };
      });
    }

    return { text, stores: finalStores };
  } catch (error: any) {
    throw new Error(error.message || "无法获取商店信息。");
  }
};
