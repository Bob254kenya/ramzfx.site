// scanner.tsx - Ramzfx Pro Scanner Bot
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { copyTradingService } from '@/services/copy-trading-service';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { useLossRequirement } from '@/hooks/useLossRequirement';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Play, StopCircle, Trash2, Scan,
  Home, RefreshCw, Shield, Zap, Eye, Anchor, Download, Upload, X, Users,
  MessageCircle, MessageSquare, Youtube, Instagram, Music, BarChart3, Activity, TrendingUp, TrendingDown, Target, Volume2, VolumeX, LineChart, Wifi, WifiOff, Trophy, ShieldAlert, GripVertical, Combine
} from 'lucide-react';
import ConfigPreview, { type BotConfig } from '@/components/bot-config/ConfigPreview';

// ============================================
// NOTIFICATION STYLES
// ============================================

const notificationStyles = \`
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideInDown {
  from {
    opacity: 0;
    transform: translateY(-30px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes slideOutUp {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(-30px) scale(0.95);
  }
}

@keyframes slideUpCenter {
  from {
    opacity: 0;
    transform: translateY(40px) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes slideDownCenter {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(40px) scale(0.9);
  }
}

@keyframes gradientShift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

@keyframes float {
  0% { transform: translateY(0px) rotate(0deg); }
  50% { transform: translateY(-8px) rotate(2deg); }
  100% { transform: translateY(0px) rotate(0deg); }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.animate-fadeIn { animation: fadeIn 0.3s ease-out forwards; }
.animate-slide-in-down { animation: slideInDown 0.4s cubic-bezier(0.34, 1.2, 0.64, 1) forwards; }
.animate-slide-out-up { animation: slideOutUp 0.3s ease-out forwards; }
.animate-slide-up-center { animation: slideUpCenter 0.4s cubic-bezier(0.34, 1.2, 0.64, 1) forwards; }
.animate-slide-down-center { animation: slideDownCenter 0.3s ease-out forwards; }
.animate-gradient { background-size: 200% 200%; animation: gradientShift 3s ease infinite; }
.animate-float { animation: float 3s ease-in-out infinite; }
.animate-pulse-slow { animation: pulse 1s ease-in-out infinite; }
\`;

// Helper function to show notification (TP/SL)
export const showTPNotification = (type: 'tp' | 'sl', message: string, amount?: number) => {
  if (typeof window !== 'undefined' && (window as any).showTPNotification) {
    (window as any).showTPNotification(type, message, amount);
  }
};

// Social Notification Popup Component
const SocialNotificationPopup = ({ onClose }: { onClose: () => void }) => {
  const [isExiting, setIsExiting] = useState(false);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const socialLinks = [
    {
      name: 'WhatsApp',
      url: 'https://+2544942149',
      icon: <MessageCircle className="w-4 h-4" />,
      color: 'hover:text-[#25D366]',
      bgGradient: 'from-green-500/20 to-green-600/20',
    },
    {
      name: 'Telegram',
      url: 'https://t.me/+YDUwvuuVDYg5NjE0',
      icon: <MessageSquare className="w-4 h-4" />,
      color: 'hover:text-[#26A5E4]',
      bgGradient: 'from-blue-500/20 to-blue-600/20',
    },
    {
      name: 'YouTube',
      url: 'https://youtube.com/@millicentalice-sc6kz',
      icon: <Youtube className="w-4 h-4" />,
      color: 'hover:text-[#FF0000]',
      bgGradient: 'from-red-500/20 to-red-600/20',
    },
    {
      name: 'Instagram',
      url: 'https://www.instagram.com/aliceousmilliie',
      icon: <Instagram className="w-4 h-4" />,
      color: 'hover:text-[#E4405F]',
      bgGradient: 'from-pink-500/20 to-pink-600/20',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pointer-events-none" style={{ paddingTop: '100px' }}>
      <div 
        className={\`
          pointer-events-auto w-[380px] max-w-[90vw] rounded-2xl shadow-2xl overflow-hidden
          \${isExiting ? 'animate-slide-out-up' : 'animate-slide-in-down'}
        \`}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 animate-gradient" />
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" />
        
        <div className="relative z-10 flex flex-col">
          <button
            onClick={handleClose}
            className="absolute top-2 right-2 p-1 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all z-20"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          
          <div className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-lg">
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Join Our Community</h2>
                <p className="text-[10px] text-white/80">Connect & Learn</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mb-3">
              {socialLinks.map((social) => (
                <a
                  key={social.name}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleClose}
                  className={\`
                    flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/15 backdrop-blur-sm
                    border border-white/30 text-white transition-all duration-300
                    hover:scale-105 hover:bg-white/25 \${social.color}
                  \`}
                >
                  <div className={\`p-1 rounded-lg bg-gradient-to-r \${social.bgGradient}\`}>
                    {social.icon}
                  </div>
                  <span className="text-[9px] font-medium truncate">{social.name}</span>
                </a>
              ))}
            </div>
          </div>
          
          <div className="p-3 pt-0 flex gap-2">
            <button
              onClick={handleClose}
              className="flex-1 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[11px] font-semibold transition-all backdrop-blur-sm border border-white/30"
            >
              CLOSE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// TP/SL Notification Component
const TPSLNotificationPopup = () => {
  const [notification, setNotification] = useState<{ type: 'tp' | 'sl'; message: string; amount?: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    (window as any).showTPNotification = (type: 'tp' | 'sl', message: string, amount?: number) => {
      setNotification({ type, message, amount });
      setIsVisible(true);
      setIsExiting(false);
      
      const timeout = setTimeout(() => {
        handleClose();
      }, 8000);
      
      return () => clearTimeout(timeout);
    };
    
    return () => {
      delete (window as any).showTPNotification;
    };
  }, []);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      setIsVisible(false);
      setNotification(null);
      setIsExiting(false);
    }, 300);
  };

  if (!isVisible || !notification) return null;

  const isTP = notification.type === 'tp';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div 
        className={\`
          pointer-events-auto w-[350px] h-[350px] rounded-xl shadow-2xl overflow-hidden
          \${isExiting ? 'animate-slide-down-center' : 'animate-slide-up-center'}
        \`}
      >
        <div className={\`
          relative w-full h-full overflow-hidden
          \${isTP 
            ? 'bg-gradient-to-br from-emerald-500 to-emerald-700' 
            : 'bg-gradient-to-br from-rose-500 to-rose-700'
          }
        \`}>
          <div className="relative w-full h-full flex flex-col p-3 z-10">
            <div className="flex items-center gap-2 mb-2">
              <div className={\`
                w-10 h-10 rounded-full flex items-center justify-center text-xl
                \${isTP 
                  ? 'bg-emerald-400/30' 
                  : 'bg-rose-400/30'
                }
                shadow-lg backdrop-blur-sm animate-pulse-slow
                flex-shrink-0
              \`}>
                {isTP ? '🎉' : '😢'}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-white">
                  {isTP ? 'TAKE PROFIT!' : 'STOP LOSS!'}
                </h3>
                <p className="text-[8px] text-white/70">
                  {new Date().toLocaleTimeString()}
                </p>
              </div>
            </div>
            
            <div className="flex-1 flex flex-col items-center justify-center text-center mb-2">
              <p className="text-white text-xs font-medium leading-tight">
                {notification.message}
              </p>
              {notification.amount && (
                <p className={\`text-xl font-bold mt-1 \${isTP ? 'text-emerald-200' : 'text-rose-200'}\`}>
                  {isTP ? '+' : '-'}\${Math.abs(notification.amount).toFixed(2)}
                </p>
              )}
            </div>
            
            <button
              onClick={handleClose}
              className={\`
                w-full py-1.5 rounded-lg font-semibold text-xs transition-all duration-200
                \${isTP 
                  ? 'bg-white/95 text-emerald-600 hover:bg-white hover:scale-[1.02]' 
                  : 'bg-white/95 text-rose-600 hover:bg-white hover:scale-[1.02]'
                }
                transform active:scale-[0.98] shadow-lg backdrop-blur-sm
              \`}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================
// MARKETS & TYPES
// ============================================

const SCANNER_MARKETS = [
  { symbol: 'R_10', name: 'Vol 10' },
  { symbol: 'R_25', name: 'Vol 25' },
  { symbol: 'R_50', name: 'Vol 50' },
  { symbol: 'R_75', name: 'Vol 75' },
  { symbol: 'R_100', name: 'Vol 100' },
  { symbol: '1HZ10V', name: 'V10 1s' },
  { symbol: '1HZ25V', name: 'V25 1s' },
  { symbol: '1HZ50V', name: 'V50 1s' },
  { symbol: 'JD10', name: 'Jump 10' },
  { symbol: 'JD25', name: 'Jump 25' },
  { symbol: 'RDBEAR', name: 'Bear' },
  { symbol: 'RDBULL', name: 'Bull' },
];

const CONTRACT_TYPES = [
  'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER',
] as const;

const needsBarrier = (ct: string) => ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct);

type BotStatus = 'idle' | 'trading_m1' | 'recovery' | 'waiting_pattern' | 'pattern_matched' | 'virtual_hook' | 'reconnecting';

interface LogEntry {
  id: number;
  time: string;
  market: 'M1' | 'M2' | 'VH' | 'SYSTEM' | 'COMBINED';
  symbol: string;
  contract: string;
  stake: number;
  martingaleStep: number;
  exitDigit: string;
  result: 'Win' | 'Loss' | 'Pending' | 'V-Win' | 'V-Loss' | 'Failed';
  pnl: number;
  balance: number;
  switchInfo: string;
}

interface BotState {
  cStake: number;
  mStep: number;
  inRecovery: boolean;
  currentPnl: number;
  currentBalance: number;
  currentMarket: 1 | 2;
  vhFakeWins: number;
  vhFakeLosses: number;
  vhConsecLosses: number;
  vhStatus: 'idle' | 'waiting' | 'confirmed' | 'failed';
  patternTradeTaken: boolean;
  combinedTradeTaken: boolean;
}

class CircularTickBuffer {
  private buffer: { digit: number; ts: number }[];
  private head = 0;
  private count = 0;
  constructor(private capacity = 1000) {
    this.buffer = new Array(capacity);
  }
  push(digit: number) {
    this.buffer[this.head] = { digit, ts: performance.now() };
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  last(n: number): number[] {
    const result: number[] = [];
    const start = (this.head - Math.min(n, this.count) + this.capacity) % this.capacity;
    for (let i = 0; i < Math.min(n, this.count); i++) {
      result.push(this.buffer[(start + i) % this.capacity].digit);
    }
    return result;
  }
  get size() { return this.count; }
}

function checkCombinedPattern(digits: number[], patternStr: string): boolean {
  if (!patternStr || patternStr.trim() === '') return false;
  const patterns = patternStr.split(',').map(p => p.trim().toUpperCase()).filter(p => p.length > 0);
  if (patterns.length === 0) return false;
  
  for (const pattern of patterns) {
    let matched = true;
    const len = pattern.length;
    if (digits.length < len) {
      matched = false;
      continue;
    }
    const recentDigits = digits.slice(-len);
    
    for (let i = 0; i < len; i++) {
      const patternChar = pattern[i];
      const digit = recentDigits[i];
      
      if (patternChar === 'U') {
        if (!(digit < 5)) { matched = false; break; }
      } else if (patternChar === 'O') {
        if (!(digit > 4)) { matched = false; break; }
      } else if (patternChar === 'E') {
        if (digit % 2 !== 0) { matched = false; break; }
      } else if (patternChar >= '0' && patternChar <= '9') {
        if (digit !== parseInt(patternChar)) { matched = false; break; }
      }
    }
    
    if (matched) return true;
  }
  return false;
}

class BalanceCache {
  private static instance: BalanceCache;
  private cache: number | null = null;
  private lastFetch: number = 0;
  private updateCallbacks: Set<(balance: number) => void> = new Set();
  
  private constructor() {}
  
  static getInstance(): BalanceCache {
    if (!BalanceCache.instance) {
      BalanceCache.instance = new BalanceCache();
    }
    return BalanceCache.instance;
  }
  
  async getBalance(refreshFn: () => Promise<number>, force: boolean = false): Promise<number> {
    const now = Date.now();
    if (!force && this.cache !== null && (now - this.lastFetch) < 500) {
      return this.cache;
    }
    
    try {
      const newBalance = await refreshFn();
      this.cache = newBalance;
      this.lastFetch = now;
      this.notifyCallbacks(newBalance);
      return newBalance;
    } catch (error) {
      console.error('Failed to fetch balance:', error);
      return this.cache ?? 0;
    }
  }
  
  optimisticUpdate(newBalance: number): void {
    this.cache = newBalance;
    this.lastFetch = Date.now();
    this.notifyCallbacks(newBalance);
  }
  
  subscribe(callback: (balance: number) => void): () => void {
    this.updateCallbacks.add(callback);
    return () => this.updateCallbacks.delete(callback);
  }
  
  private notifyCallbacks(balance: number): void {
    this.updateCallbacks.forEach(callback => callback(balance));
  }
}

export default function ProScannerBot() {
  const { isAuthorized, balance: authBalance, activeAccount, refreshBalance } = useAuth();
  const { recordLoss } = useLossRequirement();
  const location = useLocation();
  
  const [showSocialPopup, setShowSocialPopup] = useState(true);
  const balanceCache = useRef(BalanceCache.getInstance()).current;
  const [localBalance, setLocalBalance] = useState(authBalance);

  const [m1Enabled, setM1Enabled] = useState(true);
  const [m1Contract, setM1Contract] = useState('DIGITEVEN');
  const [m1Barrier, setM1Barrier] = useState('5');
  const [m1Symbol, setM1Symbol] = useState('R_100');

  const [m2Enabled, setM2Enabled] = useState(true);
  const [m2Contract, setM2Contract] = useState('DIGITODD');
  const [m2Barrier, setM2Barrier] = useState('5');
  const [m2Symbol, setM2Symbol] = useState('R_50');

  const [stake, setStake] = useState('0.6');
  const [martingaleOn, setMartingaleOn] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('5');
  const [stopLoss, setStopLoss] = useState('30');

  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const [strategyM1Enabled, setStrategyM1Enabled] = useState(false);
  const [m1StrategyMode, setM1StrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [m2StrategyMode, setM2StrategyMode] = useState<'pattern' | 'digit'>('pattern');

  const [m1Pattern, setM1Pattern] = useState('');
  const [m1DigitCondition, setM1DigitCondition] = useState('==');
  const [m1DigitCompare, setM1DigitCompare] = useState('5');
  const [m1DigitWindow, setM1DigitWindow] = useState('3');

  const [m2Pattern, setM2Pattern] = useState('');
  const [m2DigitCondition, setM2DigitCondition] = useState('==');
  const [m2DigitCompare, setM2DigitCompare] = useState('5');
  const [m2DigitWindow, setM2DigitWindow] = useState('3');

  const [scannerActive, setScannerActive] = useState(false);
  const [turboMode, setTurboMode] = useState(true);
  const [botName, setBotName] = useState('');

  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [currentMarket, setCurrentMarket] = useState<1 | 2>(1);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalStaked, setTotalStaked] = useState(0);
  const [netProfit, setNetProfit] = useState(0);
  const [currentStake, setCurrentStakeState] = useState(0);
  const [martingaleStep, setMartingaleStepState] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);

  const tickMapRef = useRef<Map<string, number[]>>(new Map());
  const [isConnected, setIsConnected] = useState(derivApi.isConnected);
  const shouldStopRef = useRef(false);

  useEffect(() => {
    const unsubscribe = balanceCache.subscribe((newBalance) => {
      setLocalBalance(newBalance);
    });
    return unsubscribe;
  }, [balanceCache]);

  useEffect(() => {
    balanceCache.optimisticUpdate(authBalance);
  }, [authBalance, balanceCache]);

  const addLog = useCallback((id: number, entry: Omit<LogEntry, 'id'>) => {
    setLogEntries(prev => [{ ...entry, id }, ...prev].slice(0, 100));
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
    setWins(0);
    setLosses(0);
    setTotalStaked(0);
    setNetProfit(0);
    setMartingaleStepState(0);
    shouldStopRef.current = false;
  }, []);

  const statusConfig: Record<BotStatus, { icon: string; label: string; color: string }> = {
    idle: { icon: '⚪', label: 'IDLE', color: 'text-muted-foreground' },
    trading_m1: { icon: '🟢', label: 'TRADING M1', color: 'text-profit' },
    recovery: { icon: '🟣', label: 'RECOVERY MODE', color: 'text-purple-400' },
    waiting_pattern: { icon: '🟡', label: 'WAITING PATTERN', color: 'text-warning' },
    pattern_matched: { icon: '✅', label: 'PATTERN MATCHED', color: 'text-profit' },
    virtual_hook: { icon: '🎣', label: 'VIRTUAL HOOK', color: 'text-primary' },
    reconnecting: { icon: '🔄', label: 'RECONNECTING...', color: 'text-orange-400' },
  };

  const status = statusConfig[botStatus];
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

  const handleCloseSocialPopup = () => {
    setShowSocialPopup(false);
  };

  return (
    <>
      <style>{notificationStyles}</style>
      
      {/* Social Notification Popup */}
      {showSocialPopup && <SocialNotificationPopup onClose={handleCloseSocialPopup} />}
      
      {/* TP/SL Notification */}
      <TPSLNotificationPopup />

      <div className="space-y-3 max-w-7xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-card/80 to-card/50 backdrop-blur-sm border border-blue-500/20 rounded-xl px-4 py-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg shadow-md">
              <Scan className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Ramzfx Pro Scanner Bot</h1>
              <p className="text-[10px] text-blue-300/80">Advanced Market Scanning & Recovery System</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={\`\${status.color} text-[9px] px-2 py-0.5 bg-muted/50 border-blue-500/20\`}>
              {status.icon} {status.label}
            </Badge>
            {isRunning && (
              <Badge variant="outline" className="text-[9px] text-warning animate-pulse font-mono border-yellow-500/30">
                P/L: \${netProfit.toFixed(2)}
              </Badge>
            )}
          </div>
        </div>

        {/* Main stats row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="bg-card border border-blue-500/20 rounded-xl p-3">
            <span className="text-xs font-semibold text-muted-foreground">Balance</span>
            <div className="font-mono text-lg font-bold text-blue-400">\${localBalance.toFixed(2)}</div>
          </div>
          <div className="bg-card border border-blue-500/20 rounded-xl p-3">
            <span className="text-xs font-semibold text-muted-foreground">W/L Record</span>
            <div className="font-mono text-lg font-bold"><span className="text-profit">{wins}</span>/<span className="text-loss">{losses}</span></div>
          </div>
          <div className="bg-card border border-blue-500/20 rounded-xl p-3">
            <span className="text-xs font-semibold text-muted-foreground">Profit/Loss</span>
            <div className={\`font-mono text-lg font-bold \${netProfit >= 0 ? 'text-profit' : 'text-loss'}\`}>\${netProfit.toFixed(2)}</div>
          </div>
          <div className="bg-card border border-blue-500/20 rounded-xl p-3">
            <span className="text-xs font-semibold text-muted-foreground">Current Stake</span>
            <div className="font-mono text-lg font-bold text-foreground">\${currentStake.toFixed(2)}{martingaleStep > 0 && <span className="text-warning ml-0.5">M{martingaleStep}</span>}</div>
          </div>
        </div>

        {/* Config section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="bg-card border-2 border-blue-500/30 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-blue-400 flex items-center gap-1"><Home className="w-3.5 h-3.5" /> M1 — Home</h3>
              <Switch checked={m1Enabled} onCheckedChange={setM1Enabled} disabled={isRunning} />
            </div>
            <Select value={m1Symbol} onValueChange={setM1Symbol} disabled={isRunning}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={m1Contract} onValueChange={setM1Contract} disabled={isRunning}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            {needsBarrier(m1Contract) && (
              <Input type="number" min="0" max="9" value={m1Barrier} onChange={e => setM1Barrier(e.target.value)} className="h-7 text-xs" disabled={isRunning} />
            )}
          </div>

          <div className="bg-card border-2 border-purple-500/30 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-purple-400 flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> M2 — Recovery</h3>
              <Switch checked={m2Enabled} onCheckedChange={setM2Enabled} disabled={isRunning} />
            </div>
            <Select value={m2Symbol} onValueChange={setM2Symbol} disabled={isRunning}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={m2Contract} onValueChange={setM2Contract} disabled={isRunning}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            {needsBarrier(m2Contract) && (
              <Input type="number" min="0" max="9" value={m2Barrier} onChange={e => setM2Barrier(e.target.value)} className="h-7 text-xs" disabled={isRunning} />
            )}
          </div>

          <div className="bg-card border-2 border-green-500/30 rounded-xl p-3 space-y-2">
            <h3 className="text-xs font-bold text-green-400 flex items-center gap-1"><Target className="w-3.5 h-3.5" /> Risk Management</h3>
            <div className="space-y-1">
              <Input type="number" step="0.01" placeholder="Stake ($)" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
              <Input type="number" placeholder="Take Profit ($)" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
              <Input type="number" placeholder="Stop Loss ($)" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
              <span className="text-xs text-muted-foreground">Martingale</span>
            </div>
          </div>
        </div>

        {/* Logs */}
        <div className="bg-card border border-blue-500/20 rounded-xl p-3 max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-blue-400">📋 Trade Log</h3>
            <Button size="sm" variant="outline" className="h-6 text-[9px] px-2" onClick={clearLog}>Clear</Button>
          </div>
          <div className="space-y-1">
            {logEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No trades yet...</p>
            ) : (
              logEntries.map(log => (
                <div key={log.id} className="text-[9px] font-mono text-muted-foreground border-l-2 border-blue-500/20 pl-2 py-1">
                  <span className="text-blue-400">[{log.time}]</span> {log.market} {log.symbol} {log.result}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
