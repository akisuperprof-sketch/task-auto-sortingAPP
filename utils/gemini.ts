import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GOOGLE_API_KEY || 'dummy-key';
const genAI = new GoogleGenerativeAI(apiKey);

// Using a standard reliable model. Update to "gemini-1.5-pro" or similar if needed.
// 2026 Context: Assuming gemini-1.5-flash is still a valid efficient model or aliased.
export const model = genAI.getGenerativeModel({ model: "gemini-pro" });
