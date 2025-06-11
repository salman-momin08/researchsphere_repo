
"use client";

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Bot, Send, MessageSquare, Loader2, X } from 'lucide-react';
import { researchSphereChatbot, ChatbotInput } from '@/ai/flows/chatbot-flow';
import { generateRobotIcon } from '@/ai/flows/generate-robot-icon-flow'; // Import the new flow
import type { ChatMessage } from '@/types';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Image from 'next/image';

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showInitialGreeting, setShowInitialGreeting] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const [robotIconUri, setRobotIconUri] = useState<string | null>(null);
  const [isLoadingIcon, setIsLoadingIcon] = useState<boolean>(true);

  useEffect(() => {
    const greetingTimer = setTimeout(() => {
      setShowInitialGreeting(true);
    }, 1500);

    const hideGreetingTimer = setTimeout(() => {
      setShowInitialGreeting(false);
    }, 7000);

    return () => {
      clearTimeout(greetingTimer);
      clearTimeout(hideGreetingTimer);
    };
  }, []);

  useEffect(() => {
    const fetchIcon = async () => {
      setIsLoadingIcon(true);
      try {
        const result = await generateRobotIcon({ prompt: "a friendly, minimalist robot assistant icon for a chatbot button, circular, simple lines, teal and white colors, high contrast" });
        setRobotIconUri(result.imageDataUri);
      } catch (error) {
        console.error("Failed to generate robot icon:", error);
        // Fallback to default icon handled by rendering logic
      } finally {
        setIsLoadingIcon(false);
      }
    };
    fetchIcon();
  }, []);

  useEffect(() => {
    if (isOpen && scrollAreaRef.current) {
      const attemptScroll = () => {
        const rootElement = scrollAreaRef.current;
        if (!rootElement) return;

        const viewportElement = rootElement.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');

        if (viewportElement && typeof viewportElement.scrollTo === 'function') {
          viewportElement.scrollTop = viewportElement.scrollHeight;
        } else {
          console.warn("Chatbot: Could not find Radix viewport with querySelector. Fallback scrolling attempts might be less reliable.");
          if (rootElement.firstElementChild && typeof rootElement.firstElementChild.scrollTo === 'function') {
            const scrollableChild = rootElement.firstElementChild as HTMLElement;
            scrollableChild.scrollTop = scrollableChild.scrollHeight;
          } else if (typeof rootElement.scrollTo === 'function') {
            rootElement.scrollTop = rootElement.scrollHeight;
          } else {
            console.warn("Chatbot: Scrollable element (Radix viewport or root) not found or does not support scrollTo method.");
          }
        }
      };
      const timerId = setTimeout(attemptScroll, 0);
      return () => clearTimeout(timerId);
    }
  }, [messages, isOpen]);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString() + '-user',
      role: 'user',
      text: inputValue,
      timestamp: new Date().toISOString(),
    };
    setMessages((prevMessages) => [...prevMessages, userMessage]);
    setInputValue('');
    setIsLoading(true);

    const historyForAI = messages.slice(-4).map(msg => ({
      role: msg.role === 'bot' ? 'model' : msg.role,
      text: msg.text
    }));

    try {
      const inputForFlow: ChatbotInput = { query: userMessage.text, history: historyForAI };
      const result = await researchSphereChatbot(inputForFlow);
      const botMessage: ChatMessage = {
        id: Date.now().toString() + '-bot',
        role: 'bot',
        text: result.response,
        timestamp: new Date().toISOString(),
      };
      setMessages((prevMessages) => [...prevMessages, botMessage]);
    } catch (error: any) {
      console.error("Chatbot error:", error);
      const errorMessage = error.message || "Sorry, I encountered an error. Please try again.";
      const errorBotMessage: ChatMessage = {
        id: Date.now().toString() + '-error',
        role: 'bot',
        text: errorMessage,
        timestamp: new Date().toISOString(),
      };
      setMessages((prevMessages) => [...prevMessages, errorBotMessage]);
      toast({
        variant: "destructive",
        title: "Chatbot Error",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="fixed right-6 z-[90]" style={{ bottom: '20%' }}>
        {showInitialGreeting && !isOpen && (
          <div className="absolute bottom-full right-0 mb-2 mr-2 px-3 py-2 bg-primary text-primary-foreground text-sm rounded-lg shadow-lg animate-in fade-in-0 slide-in-from-bottom-2">
            Hello! I am ResearchSphere Assistant.
            <div className="absolute right-3 -bottom-1 w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-primary"></div>
          </div>
        )}
        <Button
          onClick={() => setIsOpen(true)}
          variant="default"
          size="icon"
          className="rounded-full w-14 h-14 shadow-lg hover:scale-110 transition-transform flex items-center justify-center" // Added flex for centering
          aria-label="Open Chatbot"
        >
          {isLoadingIcon ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : robotIconUri ? (
            <img src={robotIconUri} alt="Chatbot AI Icon" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <Bot className="h-7 w-7" />
          )}
        </Button>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-lg p-0 flex flex-col max-h-[80vh] sm:max-h-[70vh]">
          <DialogHeader className="p-4 border-b flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Image
                src="https://placehold.co/32x32.png"
                alt="Chatbot Icon"
                width={32}
                height={32}
                className="rounded-sm"
                data-ai-hint="robot mascot"
              />
              <DialogTitle className="text-lg">ResearchSphere Assistant</DialogTitle>
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 h-[24rem] overflow-hidden">
            <ScrollArea ref={scrollAreaRef} className="h-full w-full">
              <div className="space-y-4 p-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      'flex items-end gap-2',
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    )}
                  >
                    {message.role === 'bot' && (
                      <Avatar className="h-7 w-7 self-start">
                        <AvatarFallback className="bg-secondary text-secondary-foreground text-xs"><Bot className="h-4 w-4"/></AvatarFallback>
                      </Avatar>
                    )}
                    <div
                      className={cn(
                        'max-w-[75%] rounded-lg px-3 py-2 text-sm shadow',
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground rounded-br-none'
                          : 'bg-muted text-muted-foreground rounded-bl-none'
                      )}
                    >
                      {message.text.split('\\n').map((line, index) => (
                          <span key={index}>{line}{index < message.text.split('\\n').length - 1 && <br/>}</span>
                      ))}
                    </div>
                    {message.role === 'user' && (
                      <Avatar className="h-7 w-7 self-start">
                        <AvatarFallback className="bg-primary/80 text-primary-foreground text-xs">U</AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start items-center gap-2">
                    <Avatar className="h-7 w-7 self-start">
                        <AvatarFallback className="bg-secondary text-secondary-foreground text-xs"><Bot className="h-4 w-4"/></AvatarFallback>
                      </Avatar>
                    <div className="bg-muted text-muted-foreground rounded-lg px-3 py-2 shadow rounded-bl-none">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="border-t p-4">
            <div className="flex items-center gap-2">
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !isLoading && handleSendMessage()}
                placeholder="Ask about ResearchSphere..."
                className="flex-grow"
                disabled={isLoading}
                aria-label="Chat message input"
              />
              <Button onClick={handleSendMessage} disabled={isLoading || !inputValue.trim()} size="icon" aria-label="Send message">
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
