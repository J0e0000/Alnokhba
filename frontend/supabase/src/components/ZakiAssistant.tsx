// components/ZakiAssistant.tsx
"use client";

import React, { useState } from "react";
import { Motion, AnimatePresence } from "framer-motion"; // لو بتستخدم framer-motion للأنيميشن

// التعبيرات المختلفة مع الـ Emojis/Pixels المناسبة
type Expression = "idle" | "thinking" | "surprised" | "happy" | "confident";

export default function ZakiAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [expression, setExpression] = useState<Expression>("idle");
  const [messages, setMessages] = useState<Array<{ sender: "user" | "zaki"; text: string }>>([
    { sender: "zaki", text: "أهلاً بك! 👋 أنا ذكي، جاهز ننجز مهام النهاردة؟" },
  ]);
  const [input, setInput] = useState("");

  // تعبيرات الوجه المتغيرة بناءً على الحالة
  const getAvatarExpression = () => {
    switch (expression) {
      case "thinking": return "🤔";
      case "surprised": return "😮";
      case "happy": return "🎉";
      case "confident": return "😎";
      default: return "😊";
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;

    // إضافة رسالة المستخدم
    const userMsg = input;
    setMessages((prev) => [...prev, { sender: "user", text: userMsg }]);
    setInput("");
    setExpression("thinking");

    // محاكاة رد ذكي السريع
    setTimeout(() => {
      setExpression("confident");
      setMessages((prev) => [
        ...prev,
        {
          sender: "zaki",
          text: "تمام 👌 خلينا نعملها خطوة خطوة:\n1. ادخل على صفحة الطلاب\n2. اضغط إضافة\n3. املا البيانات",
        },
      ]);
    }, 1000);
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end">
      {/* 💬 Chat Window Mode */}
      {isOpen && (
        <div className="w-80 h-96 bg-[#0B132B] text-white rounded-2xl shadow-2xl border-2 border-[#FFD700] flex flex-col mb-3 overflow-hidden animate-in fade-in slide-in-from-bottom-5">
          {/* Header */}
          <div className="bg-[#1C2541] p-3 flex justify-between items-center border-b border-[#FFD700]/20">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎓{getAvatarExpression()}</span>
              <div>
                <h3 className="font-bold text-sm text-[#FFD700]">ذكي (Zaki)</h3>
                <p className="text-[10px] text-gray-300">مساعدك الذكي</p>
              </div>
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-white text-sm px-2 py-1"
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 p-3 overflow-y-auto space-y-3 text-sm">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`p-2.5 rounded-xl max-w-[85%] whitespace-pre-line ${
                  msg.sender === "zaki"
                    ? "bg-[#1C2541] text-white border border-[#FFD700]/30 self-start rounded-tl-none"
                    : "bg-[#FFD700] text-[#0B132B] font-medium self-end ml-auto rounded-tr-none"
                }`}
              >
                {msg.text}
              </div>
            ))}
          </div>

          {/* Input Area */}
          <div className="p-2 bg-[#1C2541] flex gap-2 border-t border-[#FFD700]/20">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="اسأل ذكي أي حاجة..."
              className="flex-1 bg-[#0B132B] text-white text-xs px-3 py-2 rounded-lg outline-none border border-gray-700 focus:border-[#FFD700]"
            />
            <button
              onClick={handleSend}
              className="bg-[#FFD700] text-[#0B132B] px-3 py-2 rounded-lg font-bold text-xs hover:bg-yellow-400 transition"
            >
              إرسال
            </button>
          </div>
        </div>
      )}

      {/* 💤 Floating Launcher Button (Mini Pixel Version) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="group relative bg-[#0B132B] border-2 border-[#FFD700] p-3 rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center"
      >
        {/* طاقية التخرج + Face Expression */}
        <div className="relative text-3xl select-none">
          <span className="absolute -top-3 -right-2 text-base">🎓</span>
          {getAvatarExpression()}
        </div>

        {/* ⚡ Quick Tip/Notification Badge */}
        {!isOpen && (
          <span className="absolute -top-1 -left-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FFD700] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#FFD700]"></span>
          </span>
        )}
      </button>
    </div>
  );
}