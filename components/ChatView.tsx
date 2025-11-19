import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Bot, User, Loader2, Terminal } from 'lucide-react';
import { ChatMessage } from '../types';
import { streamChatResponse } from '../services/gemini';

const ChatView: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', text: "Systems initialized. How can I assist with your development tasks today?", timestamp: Date.now() }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = { role: 'user', text: input, timestamp: Date.now() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const botMessageId = Date.now();
      setMessages(prev => [...prev, { role: 'model', text: '', timestamp: botMessageId }]);

      let fullResponse = '';
      const stream = streamChatResponse(history, userMessage.text);
      
      for await (const chunk of stream) {
        fullResponse += chunk;
        setMessages(prev => prev.map(msg => 
          msg.timestamp === botMessageId 
            ? { ...msg, text: fullResponse }
            : msg
        ));
      }

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: "Error: Connection to neural core interrupted.", 
        timestamp: Date.now(),
        isError: true 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <header className="px-6 py-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Terminal className="text-indigo-500 w-5 h-5" /> Assistant
        </h2>
        <p className="text-sm text-slate-400">gemini-2.5-flash // active</p>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'model' && (
              <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center border border-slate-700 flex-shrink-0">
                <Bot size={18} className="text-indigo-400" />
              </div>
            )}
            
            <div className={`max-w-[85%] md:max-w-[75%] p-4 rounded-2xl ${
              msg.role === 'user' 
                ? 'bg-indigo-600 text-white rounded-br-none' 
                : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none'
            }`}>
              {msg.isError ? (
                <div className="text-red-400 flex items-center gap-2">
                  <span className="font-bold">Error:</span> {msg.text}
                </div>
              ) : (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown 
                    components={{
                      code: ({node, className, ...props}) => {
                         const match = /language-(\w+)/.exec(className || '')
                         return match 
                           ? <code className={`${className} bg-slate-950 rounded px-1 py-0.5`} {...props} />
                           : <code className="bg-slate-950 rounded px-1 py-0.5" {...props} />
                      },
                      pre: ({node, ...props}) => <pre className="bg-slate-950 border border-slate-800 rounded p-3 overflow-x-auto" {...props} />
                    }}
                  >
                    {msg.text}
                  </ReactMarkdown>
                </div>
              )}
            </div>

            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <User size={18} className="text-indigo-400" />
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-slate-800 bg-slate-900/30">
        <div className="max-w-4xl mx-auto relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter command or query..."
            className="w-full bg-slate-900 text-slate-200 rounded-xl pl-4 pr-12 py-3 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none resize-none h-[52px] placeholder:text-slate-500"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="absolute right-2 top-2 p-2 text-slate-400 hover:text-indigo-400 disabled:opacity-50 disabled:hover:text-slate-400 transition-colors"
          >
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatView;