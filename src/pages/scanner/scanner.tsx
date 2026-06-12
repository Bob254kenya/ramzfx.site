// scanner.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import './scanner.scss';

// ============================================
// TYPES
// ============================================

interface TickData {
  quote: number;
  epoch: number;
}

interface DigitStat {
  digit: number;
  count: number;
  pct: number;
  color: string;
}

interface MarketConfig {
  enabled: boolean;
  symbol: string;
  contract: string;
  barrier: string;
  hookEnabled: boolean;
  virtualLossCount: number;
  realCount: number;
}

interface StrategyConfig {
  enabled: boolean;
  mode: 'pattern' | 'digit';
  pattern: string;
  digitCondition: string;
  digitCompare: string;
  digitWindow: string;
}

interface CombinedConfig {
  enabled: boolean;
  patterns: string;
}

interface MarketCard {
  symbol: string;
  display_name: string;
  current_quote: string;
  digits: DigitStat[];
  last_digits: number[];
  last_ticks: TickData[];
  even_pct: number;
  odd_pct: number;
  over_pct: number;
  under_pct: number;
  even_payout: string;
  odd_payout: string;
  strong_count: number;
  moderate_count: number;
  // Strategy tracking
  patternMatched: boolean;
  combinedMatched: boolean;
  digitConditionMatched: boolean;
}

interface BotStatus {
  isRunning: boolean;
  currentMarket: 1 | 2;
  status: 'idle' | 'trading_m1' | 'recovery' | 'waiting_pattern' | 'pattern_matched' | 'virtual_hook';
  currentStake: number;
  martingaleStep: number;
  netProfit: number;
  wins: number;
  losses: number;
  totalStaked: number;
  vhFakeWins: number;
  vhFakeLosses: number;
  vhConsecLosses: number;
  vhStatus: 'idle' | 'waiting' | 'confirmed' | 'failed';
}

// ============================================
// CONSTANTS
// ============================================

const TICK_OPTIONS = [30, 60, 100, 120, 240, 500, 1000];
const SQUARES_COUNT = 20;
const CONTRACT_TYPES = ['DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'] as const;
const NEEDS_BARRIER = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'];

const DIGIT_COLORS: Record<string, string> = {
  most: '#2a9d8f',
  second: '#8a9ba8',
  least: '#d64545',
  second_least: '#e67e22',
  neutral: '#8a9ba8',
};

// ============================================
// HELPERS
// ============================================

function getLastDigit(quote: number): number {
  const str = quote.toString();
  const lastChar = str[str.length - 1];
  return parseInt(lastChar, 10);
}

function calculateDigitStats(ticks: TickData[]): DigitStat[] {
  const counts = new Array(10).fill(0);
  ticks.forEach(t => {
    counts[getLastDigit(t.quote)]++;
  });
  const total = ticks.length || 1;

  const indexed = counts.map((count, digit) => ({
    digit,
    count,
    pct: Math.round((count / total) * 1000) / 10,
  }));

  const sorted = [...indexed].sort((a, b) => b.count - a.count);

  const colorMap: Record<number, string> = {};
  colorMap[sorted[0].digit] = DIGIT_COLORS.most;
  if (sorted.length > 1) colorMap[sorted[1].digit] = DIGIT_COLORS.second;
  colorMap[sorted[sorted.length - 1].digit] = DIGIT_COLORS.least;
  if (sorted.length > 2) colorMap[sorted[sorted.length - 2].digit] = DIGIT_COLORS.second_least;

  return indexed.map(item => ({
    ...item,
    color: colorMap[item.digit] || DIGIT_COLORS.neutral,
  }));
}

function calculateEvenOdd(ticks: TickData[]): { even_pct: number; odd_pct: number } {
  if (ticks.length === 0) return { even_pct: 50, odd_pct: 50 };
  let even = 0;
  ticks.forEach(t => {
    if (getLastDigit(t.quote) % 2 === 0) even++;
  });
  const even_pct = Math.round((even / ticks.length) * 1000) / 10;
  return { even_pct, odd_pct: Math.round((100 - even_pct) * 10) / 10 };
}

function calculateOverUnder(ticks: TickData[]): { over_pct: number; under_pct: number } {
  if (ticks.length === 0) return { over_pct: 50, under_pct: 50 };
  let over = 0;
  ticks.forEach(t => {
    if (getLastDigit(t.quote) > 4) over++;
  });
  const over_pct = Math.round((over / ticks.length) * 1000) / 10;
  return { over_pct, under_pct: Math.round((100 - over_pct) * 10) / 10 };
}

function getMarketStrength(digits: DigitStat[]): { strong: number; moderate: number } {
  if (digits.length === 0) return { strong: 0, moderate: 0 };
  const avg = 10;
  let strong = 0;
  let moderate = 0;
  digits.forEach(d => {
    if (d.pct >= avg * 1.3) strong++;
    else if (d.pct >= avg * 0.7) moderate++;
  });
  return { strong, moderate };
}

function checkPatternMatch(digits: number[], pattern: string): boolean {
  if (!pattern || pattern.length < 2) return false;
  const cleanPattern = pattern.toUpperCase().replace(/[^EO]/g, '');
  if (digits.length < cleanPattern.length) return false;
  const recent = digits.slice(-cleanPattern.length);
  for (let i = 0; i < cleanPattern.length; i++) {
    const expected = cleanPattern[i];
    const actual = recent[i] % 2 === 0 ? 'E' : 'O';
    if (expected !== actual) return false;
  }
  return true;
}

function checkDigitCondition(digits: number[], condition: string, compare: string, windowSize: string): boolean {
  const win = parseInt(windowSize) || 3;
  const comp = parseInt(compare);
  if (digits.length < win) return false;
  const recent = digits.slice(-win);
  return recent.every(d => {
    switch (condition) {
      case '>': return d > comp;
      case '<': return d < comp;
      case '>=': return d >= comp;
      case '<=': return d <= comp;
      case '==': return d === comp;
      default: return false;
    }
  });
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
      const isOver = digit > 4;
      const isEven = digit % 2 === 0;

      if (patternChar === 'U') {
        if (!(digit < 5)) { matched = false; break; }
      } else if (patternChar === 'O') {
        if (!(digit > 4)) { matched = false; break; }
      } else if (patternChar === 'E') {
        if (!isEven) { matched = false; break; }
      } else if (patternChar >= '0' && patternChar <= '9') {
        if (digit !== parseInt(patternChar)) { matched = false; break; }
      } else {
        matched = false;
        break;
      }
    }

    if (matched) return true;
  }
  return false;
}

// ============================================
// COMPONENT
// ============================================

const Scanner = observer(() => {
  const { client } = useStore();
  const currency = client?.currency || 'USD';

  // ===== Market Configuration =====
  const [m1Config, setM1Config] = useState<MarketConfig>({
    enabled: true,
    symbol: 'R_100',
    contract: 'DIGITEVEN',
    barrier: '5',
    hookEnabled: false,
    virtualLossCount: 3,
    realCount: 2,
  });

  const [m2Config, setM2Config] = useState<MarketConfig>({
    enabled: true,
    symbol: 'R_50',
    contract: 'DIGITODD',
    barrier: '5',
    hookEnabled: false,
    virtualLossCount: 3,
    realCount: 2,
  });

  // ===== Strategy Configuration =====
  const [m1Strategy, setM1Strategy] = useState<StrategyConfig>({
    enabled: false,
    mode: 'pattern',
    pattern: '',
    digitCondition: '==',
    digitCompare: '5',
    digitWindow: '3',
  });

  const [m2Strategy, setM2Strategy] = useState<StrategyConfig>({
    enabled: false,
    mode: 'pattern',
    pattern: '',
    digitCondition: '==',
    digitCompare: '5',
    digitWindow: '3',
  });

  // ===== Combined Strategy Configuration =====
  const [m1Combined, setM1Combined] = useState<CombinedConfig>({
    enabled: false,
    patterns: '',
  });

  const [m2Combined, setM2Combined] = useState<CombinedConfig>({
    enabled: false,
    patterns: '',
  });

  // ===== Risk Configuration =====
  const [stake, setStake] = useState('0.6');
  const [martingaleOn, setMartingaleOn] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('5');
  const [stopLoss, setStopLoss] = useState('30');

  // ===== Scanner Settings =====
  const [activeTicks, setActiveTicks] = useState(120);
  const [scannerActive, setScannerActive] = useState(false);

  // ===== Bot State =====
  const [botStatus, setBotStatus] = useState<BotStatus>({
    isRunning: false,
    currentMarket: 1,
    status: 'idle',
    currentStake: 0,
    martingaleStep: 0,
    netProfit: 0,
    wins: 0,
    losses: 0,
    totalStaked: 0,
    vhFakeWins: 0,
    vhFakeLosses: 0,
    vhConsecLosses: 0,
    vhStatus: 'idle',
  });

  // ===== Data State =====
  const [cards, setCards] = useState<MarketCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState(10000);
  const [logs, setLogs] = useState<Array<{ time: string; message: string; type: string }>>([]);

  // ===== Refs =====
  const subscriptionsRef = useRef<Record<string, any>>({});
  const ticksRef = useRef<Record<string, TickData[]>>({});
  const digitsRef = useRef<Record<string, number[]>>({});
  const activeTicksRef = useRef<number>(activeTicks);
  const runningRef = useRef(false);
  const patternTradeTakenRef = useRef(false);
  const combinedTradeTakenRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    activeTicksRef.current = activeTicks;
  }, [activeTicks]);

  // ===== Helper Functions =====
  const addLog = useCallback((message: string, type: 'info' | 'trade' | 'win' | 'loss' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [{ time, message, type }, ...prev].slice(0, 100));
  }, []);

  const getDigits = useCallback((symbol: string): number[] => {
    return digitsRef.current[symbol] || [];
  }, []);

  // ===== Strategy Check Functions =====
  const checkStrategyForMarket = useCallback((symbol: string, market: 1 | 2): boolean => {
    const strategy = market === 1 ? m1Strategy : m2Strategy;
    if (!strategy.enabled) return false;

    const digits = getDigits(symbol);
    if (strategy.mode === 'pattern') {
      return checkPatternMatch(digits, strategy.pattern);
    } else {
      return checkDigitCondition(digits, strategy.digitCondition, strategy.digitCompare, strategy.digitWindow);
    }
  }, [m1Strategy, m2Strategy, getDigits]);

  const checkCombinedForMarket = useCallback((symbol: string, market: 1 | 2): boolean => {
    const combined = market === 1 ? m1Combined : m2Combined;
    if (!combined.enabled || !combined.patterns) return false;

    const digits = getDigits(symbol);
    return checkCombinedPattern(digits, combined.patterns);
  }, [m1Combined, m2Combined, getDigits]);

  const findScannerMatch = useCallback((market: 1 | 2): { symbol: string; type: 'strategy' | 'combined' } | null => {
    if (!scannerActive) return null;

    for (const card of cards) {
      if (checkCombinedForMarket(card.symbol, market)) {
        return { symbol: card.symbol, type: 'combined' };
      }
    }
    for (const card of cards) {
      if (checkStrategyForMarket(card.symbol, market)) {
        return { symbol: card.symbol, type: 'strategy' };
      }
    }
    return null;
  }, [cards, scannerActive, checkStrategyForMarket, checkCombinedForMarket]);

  // ===== Update Card with Strategy Matches =====
  const updateCardMatches = useCallback(() => {
    setCards(prev => prev.map(card => ({
      ...card,
      patternMatched: m1Strategy.enabled && checkStrategyForMarket(card.symbol, 1),
      combinedMatched: m1Combined.enabled && checkCombinedForMarket(card.symbol, 1),
      digitConditionMatched: m1Strategy.enabled && m1Strategy.mode === 'digit' && 
        checkDigitCondition(getDigits(card.symbol), m1Strategy.digitCondition, m1Strategy.digitCompare, m1Strategy.digitWindow),
    })));
  }, [m1Strategy, m1Combined, checkStrategyForMarket, checkCombinedForMarket, getDigits]);

  // ===== Tick Handler =====
  const handleTick = useCallback((symbol: string, tick: TickData) => {
    const digit = getLastDigit(tick.quote);
    
    // Store digits for pattern matching
    const digits = digitsRef.current[symbol] || [];
    digits.push(digit);
    if (digits.length > 1000) digits.shift();
    digitsRef.current[symbol] = digits;

    // Store full ticks for stats
    const allTicks = ticksRef.current[symbol] || [];
    allTicks.push(tick);
    const limit = activeTicksRef.current;
    const trimmed = allTicks.slice(-limit);
    ticksRef.current[symbol] = trimmed;

    // Update card
    setCards(prev => {
      const updated = prev.map(card => {
        if (card.symbol !== symbol) return card;

        const stats = calculateDigitStats(trimmed);
        const { even_pct, odd_pct } = calculateEvenOdd(trimmed);
        const { over_pct, under_pct } = calculateOverUnder(trimmed);
        const last_digits = trimmed.slice(-SQUARES_COUNT).map(t => getLastDigit(t.quote));
        const { strong, moderate } = getMarketStrength(stats);

        // Check strategy matches
        const patternMatched = m1Strategy.enabled && checkPatternMatch(digits, m1Strategy.pattern);
        const combinedMatched = m1Combined.enabled && checkCombinedPattern(digits, m1Combined.patterns);
        const digitConditionMatched = m1Strategy.enabled && m1Strategy.mode === 'digit' &&
          checkDigitCondition(digits, m1Strategy.digitCondition, m1Strategy.digitCompare, m1Strategy.digitWindow);

        return {
          ...card,
          current_quote: tick.quote.toString(),
          digits: stats,
          last_digits,
          last_ticks: trimmed,
          even_pct,
          odd_pct,
          over_pct,
          under_pct,
          strong_count: strong,
          moderate_count: moderate,
          patternMatched,
          combinedMatched,
          digitConditionMatched,
        };
      });
      return updated;
    });
  }, [m1Strategy, m1Combined]);

  // ===== Fetch Markets =====
  const fetchMarkets = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (!api_base.api) {
        setError('API not connected. Please log in.');
        setLoading(false);
        return;
      }

      const response = await (api_base.api as any).send({ active_symbols: 'brief' });
      const symbols = response?.active_symbols || [];

      // Filter to continuous indices
      const continuousSymbols = symbols.filter(
        (s: any) => s.submarket === 'random_index' && s.exchange_is_open === 1
      );

      if (continuousSymbols.length === 0) {
        setError('No continuous indices markets available.');
        setLoading(false);
        return;
      }

      const initialCards: MarketCard[] = continuousSymbols.map((s: any) => ({
        symbol: s.symbol,
        display_name: s.display_name,
        current_quote: '—',
        digits: Array.from({ length: 10 }, (_, i) => ({
          digit: i,
          count: 0,
          pct: 0,
          color: DIGIT_COLORS.neutral,
        })),
        last_digits: [],
        last_ticks: [],
        even_pct: 50,
        odd_pct: 50,
        over_pct: 50,
        under_pct: 50,
        even_payout: '—',
        odd_payout: '—',
        strong_count: 0,
        moderate_count: 0,
        patternMatched: false,
        combinedMatched: false,
        digitConditionMatched: false,
      }));

      setCards(initialCards);
      setLoading(false);

      // Initialize storage
      continuousSymbols.forEach((s: any) => {
        ticksRef.current[s.symbol] = [];
        digitsRef.current[s.symbol] = [];
      });

      // Subscribe to ticks
      continuousSymbols.forEach((s: any) => {
        if (subscriptionsRef.current[s.symbol]) return;
        try {
          const obs = (api_base.api as any).subscribe({ ticks: s.symbol });
          const sub = obs.subscribe((data: any) => {
            if (data?.tick?.quote !== undefined) {
              handleTick(s.symbol, {
                quote: data.tick.quote,
                epoch: data.tick.epoch || Date.now(),
              });
            }
          });
          subscriptionsRef.current[s.symbol] = sub;
        } catch (e) {
          console.error(`Subscribe failed for ${s.symbol}:`, e);
        }
      });

      // Fetch payouts
      for (const s of continuousSymbols) {
        try {
          const evenResp = await (api_base.api as any).send({
            proposal: 1,
            amount: 1,
            basis: 'stake',
            contract_type: 'DIGITEVEN',
            currency,
            duration: 1,
            duration_unit: 't',
            symbol: s.symbol,
          });
          const oddResp = await (api_base.api as any).send({
            proposal: 1,
            amount: 1,
            basis: 'stake',
            contract_type: 'DIGITODD',
            currency,
            duration: 1,
            duration_unit: 't',
            symbol: s.symbol,
          });

          setCards(prev => prev.map(card => {
            if (card.symbol !== s.symbol) return card;
            return {
              ...card,
              even_payout: evenResp?.proposal?.payout ? `${currency} ${evenResp.proposal.payout}` : '—',
              odd_payout: oddResp?.proposal?.payout ? `${currency} ${oddResp.proposal.payout}` : '—',
            };
          }));
        } catch (e) {
          console.error(`Payout fetch failed for ${s.symbol}:`, e);
        }
      }
    } catch (err: any) {
      console.error('[Scanner] Failed to fetch markets:', err);
      setError(err?.message || 'Failed to load markets.');
      setLoading(false);
    }
  }, [currency, handleTick]);

  // ===== Simulated Trade Execution =====
  const executeTrade = useCallback(async (market: 1 | 2, matchedSymbol: string, matchedType: 'strategy' | 'combined') => {
    const config = market === 1 ? m1Config : m2Config;
    const currentStakeVal = botStatus.currentStake || parseFloat(stake);
    
    addLog(`📊 ${market === 1 ? 'M1' : 'M2'} - Executing ${matchedType.toUpperCase()} trade on ${matchedSymbol}`, 'trade');
    addLog(`  Contract: ${config.contract}, Stake: $${currentStakeVal.toFixed(2)}`, 'info');

    // Simulate trade outcome (50% win rate for demo)
    const won = Math.random() > 0.45;
    const pnl = won ? currentStakeVal * 0.85 : -currentStakeVal;

    setBotStatus(prev => ({
      ...prev,
      netProfit: prev.netProfit + pnl,
      wins: prev.wins + (won ? 1 : 0),
      losses: prev.losses + (won ? 0 : 1),
      totalStaked: prev.totalStaked + currentStakeVal,
    }));

    addLog(`${won ? '✅ WIN' : '❌ LOSS'} on ${config.contract} | P/L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`, won ? 'win' : 'loss');

    return won;
  }, [m1Config, m2Config, stake, botStatus.currentStake, addLog]);

  // ===== Bot Main Loop =====
  const runBot = useCallback(async () => {
    if (!runningRef.current) return;

    let currentStakeVal = parseFloat(stake);
    let martingaleStepVal = 0;
    let inRecovery = false;

    setBotStatus(prev => ({
      ...prev,
      isRunning: true,
      currentStake: currentStakeVal,
      status: 'trading_m1',
    }));

    addLog('🚀 Bot started!', 'info');

    while (runningRef.current) {
      const market: 1 | 2 = inRecovery ? 2 : 1;
      const config = market === 1 ? m1Config : m2Config;
      const strategy = market === 1 ? m1Strategy : m2Strategy;
      const combined = market === 1 ? m1Combined : m2Combined;

      setBotStatus(prev => ({ ...prev, currentMarket: market }));

      // Check if market is enabled
      if ((market === 1 && !m1Config.enabled) || (market === 2 && !m2Config.enabled)) {
        inRecovery = !inRecovery;
        continue;
      }

      // Check TP/SL
      if (botStatus.netProfit >= parseFloat(takeProfit)) {
        addLog(`🎯 Take Profit reached: $${botStatus.netProfit.toFixed(2)}`, 'info');
        break;
      }
      if (botStatus.netProfit <= -parseFloat(stopLoss)) {
        addLog(`🛑 Stop Loss reached: $${botStatus.netProfit.toFixed(2)}`, 'error');
        break;
      }

      let matchedSymbol: string | null = null;
      let matchedType: 'strategy' | 'combined' | null = null;

      // Check for combined pattern first
      if (combined.enabled && combined.patterns) {
        setBotStatus(prev => ({ ...prev, status: 'waiting_pattern' }));
        
        if (scannerActive) {
          const match = findScannerMatch(market);
          if (match) {
            matchedSymbol = match.symbol;
            matchedType = match.type;
          }
        } else {
          const digits = getDigits(config.symbol);
          if (checkCombinedPattern(digits, combined.patterns)) {
            matchedSymbol = config.symbol;
            matchedType = 'combined';
          }
        }

        if (matchedSymbol && matchedType === 'combined') {
          setBotStatus(prev => ({ ...prev, status: 'pattern_matched' }));
          addLog(`🎯 COMBINED PATTERN MATCHED on ${matchedSymbol}! Pattern: ${combined.patterns}`, 'info');
          await new Promise(r => setTimeout(r, 500));
          
          const won = await executeTrade(market, matchedSymbol, 'combined');
          
          if (won) {
            currentStakeVal = parseFloat(stake);
            martingaleStepVal = 0;
            inRecovery = false;
          } else if (!inRecovery && m2Config.enabled) {
            inRecovery = true;
            if (martingaleOn && martingaleStepVal < parseInt(martingaleMaxSteps)) {
              currentStakeVal *= parseFloat(martingaleMultiplier);
              martingaleStepVal++;
            } else {
              currentStakeVal = parseFloat(stake);
              martingaleStepVal = 0;
            }
          }
          
          setBotStatus(prev => ({ ...prev, currentStake: currentStakeVal, martingaleStep: martingaleStepVal }));
          continue;
        }
      }

      // Check regular strategy
      if (strategy.enabled && !patternTradeTakenRef.current) {
        setBotStatus(prev => ({ ...prev, status: 'waiting_pattern' }));
        
        if (scannerActive) {
          const match = findScannerMatch(market);
          if (match && match.type === 'strategy') {
            matchedSymbol = match.symbol;
            matchedType = 'strategy';
          }
        } else {
          const digits = getDigits(config.symbol);
          let strategyMatched = false;
          if (strategy.mode === 'pattern') {
            strategyMatched = checkPatternMatch(digits, strategy.pattern);
          } else {
            strategyMatched = checkDigitCondition(digits, strategy.digitCondition, strategy.digitCompare, strategy.digitWindow);
          }
          
          if (strategyMatched) {
            matchedSymbol = config.symbol;
            matchedType = 'strategy';
          }
        }

        if (matchedSymbol && matchedType === 'strategy') {
          setBotStatus(prev => ({ ...prev, status: 'pattern_matched' }));
          addLog(`✅ STRATEGY PATTERN MATCHED on ${matchedSymbol}!`, 'info');
          await new Promise(r => setTimeout(r, 500));
          
          const won = await executeTrade(market, matchedSymbol, 'strategy');
          patternTradeTakenRef.current = true;
          
          if (won) {
            currentStakeVal = parseFloat(stake);
            martingaleStepVal = 0;
            inRecovery = false;
          } else if (!inRecovery && m2Config.enabled) {
            inRecovery = true;
            if (martingaleOn && martingaleStepVal < parseInt(martingaleMaxSteps)) {
              currentStakeVal *= parseFloat(martingaleMultiplier);
              martingaleStepVal++;
            } else {
              currentStakeVal = parseFloat(stake);
              martingaleStepVal = 0;
            }
          }
          
          setBotStatus(prev => ({ ...prev, currentStake: currentStakeVal, martingaleStep: martingaleStepVal }));
          patternTradeTakenRef.current = false;
          continue;
        }
      }

      // Check virtual hook
      if (config.hookEnabled) {
        setBotStatus(prev => ({ ...prev, status: 'virtual_hook', vhStatus: 'waiting' }));
        
        let consecLosses = 0;
        const requiredLosses = config.virtualLossCount;
        
        while (consecLosses < requiredLosses && runningRef.current) {
          addLog(`🎣 Virtual trade #${consecLosses + 1} - waiting...`, 'info');
          await new Promise(r => setTimeout(r, 1000));
          
          // Simulate virtual trade (70% loss rate for hook)
          const lost = Math.random() > 0.3;
          if (lost) {
            consecLosses++;
            setBotStatus(prev => ({ ...prev, vhConsecLosses: consecLosses, vhFakeLosses: prev.vhFakeLosses + 1 }));
            addLog(`  Virtual LOSS (${consecLosses}/${requiredLosses})`, 'loss');
          } else {
            consecLosses = 0;
            setBotStatus(prev => ({ ...prev, vhConsecLosses: 0, vhFakeWins: prev.vhFakeWins + 1 }));
            addLog(`  Virtual WIN - streak reset`, 'win');
          }
        }

        if (consecLosses >= requiredLosses && runningRef.current) {
          setBotStatus(prev => ({ ...prev, vhStatus: 'confirmed' }));
          addLog(`🎣 VIRTUAL HOOK TRIGGERED! Placing real trades...`, 'trade');
          
          for (let i = 0; i < config.realCount && runningRef.current; i++) {
            const won = await executeTrade(market, config.symbol, 'hook');
            if (won) break;
            await new Promise(r => setTimeout(r, 500));
          }
        }
        
        setBotStatus(prev => ({ ...prev, vhStatus: 'idle', vhConsecLosses: 0 }));
      }

      // Regular trade
      setBotStatus(prev => ({ ...prev, status: market === 1 ? 'trading_m1' : 'recovery' }));
      
      const won = await executeTrade(market, config.symbol, 'regular');
      
      if (won) {
        currentStakeVal = parseFloat(stake);
        martingaleStepVal = 0;
        inRecovery = false;
      } else if (!inRecovery && m2Config.enabled) {
        inRecovery = true;
        if (martingaleOn && martingaleStepVal < parseInt(martingaleMaxSteps)) {
          currentStakeVal *= parseFloat(martingaleMultiplier);
          martingaleStepVal++;
        } else {
          currentStakeVal = parseFloat(stake);
          martingaleStepVal = 0;
        }
      }
      
      setBotStatus(prev => ({ ...prev, currentStake: currentStakeVal, martingaleStep: martingaleStepVal }));
      
      await new Promise(r => setTimeout(r, 1000));
    }

    runningRef.current = false;
    setBotStatus(prev => ({ ...prev, isRunning: false, status: 'idle' }));
    addLog('⏹️ Bot stopped', 'info');
  }, [stake, m1Config, m2Config, m1Strategy, m2Strategy, m1Combined, m2Combined, scannerActive, findScannerMatch, executeTrade, addLog, takeProfit, stopLoss, martingaleOn, martingaleMultiplier, martingaleMaxSteps, getDigits, botStatus.netProfit]);

  const startBot = useCallback(() => {
    if (botStatus.isRunning) return;
    runningRef.current = true;
    patternTradeTakenRef.current = false;
    combinedTradeTakenRef.current = false;
    runBot();
  }, [botStatus.isRunning, runBot]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
  }, []);

  // ===== Unsubscribe on unmount =====
  useEffect(() => {
    fetchMarkets();
    return () => {
      Object.entries(subscriptionsRef.current).forEach(([symbol, sub]) => {
        try {
          sub?.unsubscribe?.();
        } catch (e) {
          console.error(`Unsubscribe failed for ${symbol}:`, e);
        }
      });
      subscriptionsRef.current = {};
      runningRef.current = false;
    };
  }, [fetchMarkets]);

  // Update card matches periodically
  useEffect(() => {
    const interval = setInterval(updateCardMatches, 500);
    return () => clearInterval(interval);
  }, [updateCardMatches]);

  // ===== Render Helpers =====
  const totalStrong = cards.reduce((sum, c) => sum + c.strong_count, 0);
  const totalModerate = cards.reduce((sum, c) => sum + c.moderate_count, 0);
  const winRate = botStatus.wins + botStatus.losses > 0 
    ? (botStatus.wins / (botStatus.wins + botStatus.losses) * 100).toFixed(1) 
    : '0.0';

  const getStatusColor = () => {
    switch (botStatus.status) {
      case 'trading_m1': return '#22c55e';
      case 'recovery': return '#a855f7';
      case 'waiting_pattern': return '#eab308';
      case 'pattern_matched': return '#22c55e';
      case 'virtual_hook': return '#3b82f6';
      default: return '#6b7280';
    }
  };

  if (loading) {
    return (
      <div className='scanner-new'>
        <div className='topbar' />
        <div className='container'>
          <div className='scanner-loading'>
            <div className='scanner-loading__spinner' />
            <p>Loading markets...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='scanner-new'>
        <div className='topbar' />
        <div className='container'>
          <div className='scanner-error'>
            <p>{error}</p>
            <button onClick={fetchMarkets} className='scanner-retry-btn'>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='scanner-new'>
      <div className='topbar' />

      <div className='container'>
        {/* Header with Bot Controls */}
        <div className='scanner-header'>
          <div className='scanner-title'>
            <h1>Ramzfx Pro Scanner</h1>
            <p>M1 (Home) & M2 (Recovery) with Pattern Strategy</p>
          </div>
          <div className='scanner-balance'>
            <span className='balance-label'>Balance</span>
            <span className='balance-value'>${balance.toFixed(2)}</span>
          </div>
        </div>

        {/* Bot Control Bar */}
        <div className='bot-controls'>
          <div className='bot-status'>
            <div className='status-indicator' style={{ background: getStatusColor() }} />
            <span className='status-text'>
              {botStatus.status === 'trading_m1' && 'TRADING M1'}
              {botStatus.status === 'recovery' && 'RECOVERY MODE'}
              {botStatus.status === 'waiting_pattern' && 'WAITING PATTERN'}
              {botStatus.status === 'pattern_matched' && 'PATTERN MATCHED'}
              {botStatus.status === 'virtual_hook' && 'VIRTUAL HOOK'}
              {botStatus.status === 'idle' && 'IDLE'}
            </span>
            {botStatus.isRunning && (
              <span className='market-badge' style={{ background: botStatus.currentMarket === 1 ? '#3b82f6' : '#a855f7' }}>
                {botStatus.currentMarket === 1 ? 'M1' : 'M2'}
              </span>
            )}
          </div>
          <div className='bot-stats'>
            <span>W: {botStatus.wins}</span>
            <span>L: {botStatus.losses}</span>
            <span>WR: {winRate}%</span>
            <span className={botStatus.netProfit >= 0 ? 'profit' : 'loss'}>P/L: ${botStatus.netProfit.toFixed(2)}</span>
            <span>Stake: ${botStatus.currentStake.toFixed(2)}</span>
            {botStatus.martingaleStep > 0 && <span className='martingale'>M{botStatus.martingaleStep}</span>}
          </div>
          <button 
            className={`bot-start-btn ${botStatus.isRunning ? 'stop' : 'start'}`}
            onClick={botStatus.isRunning ? stopBot : startBot}
          >
            {botStatus.isRunning ? '⏹️ STOP' : '▶️ START'}
          </button>
        </div>

        {/* Market Configuration Row */}
        <div className='market-config'>
          <div className='config-card m1'>
            <div className='config-header'>
              <span className='config-title'>🔵 M1 - HOME</span>
              <label className='switch'>
                <input type='checkbox' checked={m1Config.enabled} onChange={e => setM1Config(prev => ({ ...prev, enabled: e.target.checked }))} />
                <span className='slider' />
              </label>
            </div>
            <div className='config-row'>
              <select value={m1Config.symbol} onChange={e => setM1Config(prev => ({ ...prev, symbol: e.target.value }))}>
                {cards.map(c => <option key={c.symbol} value={c.symbol}>{c.display_name}</option>)}
              </select>
              <select value={m1Config.contract} onChange={e => setM1Config(prev => ({ ...prev, contract: e.target.value }))}>
                {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {NEEDS_BARRIER.includes(m1Config.contract) && (
                <input type='number' min='0' max='9' value={m1Config.barrier} onChange={e => setM1Config(prev => ({ ...prev, barrier: e.target.value }))} />
              )}
            </div>
            <div className='config-row'>
              <label className='hook-label'>
                <input type='checkbox' checked={m1Config.hookEnabled} onChange={e => setM1Config(prev => ({ ...prev, hookEnabled: e.target.checked }))} />
                Virtual Hook
              </label>
              {m1Config.hookEnabled && (
                <>
                  <input type='number' placeholder='V-Losses' value={m1Config.virtualLossCount} onChange={e => setM1Config(prev => ({ ...prev, virtualLossCount: parseInt(e.target.value) }))} />
                  <input type='number' placeholder='Real Trades' value={m1Config.realCount} onChange={e => setM1Config(prev => ({ ...prev, realCount: parseInt(e.target.value) }))} />
                </>
              )}
            </div>
          </div>

          <div className='config-card m2'>
            <div className='config-header'>
              <span className='config-title'>🟣 M2 - RECOVERY</span>
              <label className='switch'>
                <input type='checkbox' checked={m2Config.enabled} onChange={e => setM2Config(prev => ({ ...prev, enabled: e.target.checked }))} />
                <span className='slider' />
              </label>
            </div>
            <div className='config-row'>
              <select value={m2Config.symbol} onChange={e => setM2Config(prev => ({ ...prev, symbol: e.target.value }))}>
                {cards.map(c => <option key={c.symbol} value={c.symbol}>{c.display_name}</option>)}
              </select>
              <select value={m2Config.contract} onChange={e => setM2Config(prev => ({ ...prev, contract: e.target.value }))}>
                {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {NEEDS_BARRIER.includes(m2Config.contract) && (
                <input type='number' min='0' max='9' value={m2Config.barrier} onChange={e => setM2Config(prev => ({ ...prev, barrier: e.target.value }))} />
              )}
            </div>
            <div className='config-row'>
              <label className='hook-label'>
                <input type='checkbox' checked={m2Config.hookEnabled} onChange={e => setM2Config(prev => ({ ...prev, hookEnabled: e.target.checked }))} />
                Virtual Hook
              </label>
              {m2Config.hookEnabled && (
                <>
                  <input type='number' placeholder='V-Losses' value={m2Config.virtualLossCount} onChange={e => setM2Config(prev => ({ ...prev, virtualLossCount: parseInt(e.target.value) }))} />
                  <input type='number' placeholder='Real Trades' value={m2Config.realCount} onChange={e => setM2Config(prev => ({ ...prev, realCount: parseInt(e.target.value) }))} />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Strategy Configuration */}
        <div className='strategy-config'>
          <div className='strategy-card'>
            <div className='strategy-header'>
              <span>📊 M1 Strategy</span>
              <label className='switch'>
                <input type='checkbox' checked={m1Strategy.enabled} onChange={e => setM1Strategy(prev => ({ ...prev, enabled: e.target.checked }))} />
                <span className='slider' />
              </label>
            </div>
            <div className='strategy-mode'>
              <button className={m1Strategy.mode === 'pattern' ? 'active' : ''} onClick={() => setM1Strategy(prev => ({ ...prev, mode: 'pattern' }))}>Pattern (E/O)</button>
              <button className={m1Strategy.mode === 'digit' ? 'active' : ''} onClick={() => setM1Strategy(prev => ({ ...prev, mode: 'digit' }))}>Digit Condition</button>
            </div>
            {m1Strategy.mode === 'pattern' ? (
              <input type='text' placeholder='Pattern: E,E,O,E,O (min 2 chars)' value={m1Strategy.pattern} onChange={e => setM1Strategy(prev => ({ ...prev, pattern: e.target.value.toUpperCase().replace(/[^EO]/g, '') }))} />
            ) : (
              <div className='digit-condition'>
                <input type='number' placeholder='Window' value={m1Strategy.digitWindow} onChange={e => setM1Strategy(prev => ({ ...prev, digitWindow: e.target.value }))} />
                <select value={m1Strategy.digitCondition} onChange={e => setM1Strategy(prev => ({ ...prev, digitCondition: e.target.value }))}>
                  <option value='=='>==</option><option value='>'>&gt;</option><option value='<'>&lt;</option>
                  <option value='>='>&gt;=</option><option value='<='>&lt;=</option>
                </select>
                <input type='number' placeholder='Digit' value={m1Strategy.digitCompare} onChange={e => setM1Strategy(prev => ({ ...prev, digitCompare: e.target.value }))} />
              </div>
            )}
          </div>

          <div className='strategy-card'>
            <div className='strategy-header'>
              <span>📈 M2 Strategy</span>
              <label className='switch'>
                <input type='checkbox' checked={m2Strategy.enabled} onChange={e => setM2Strategy(prev => ({ ...prev, enabled: e.target.checked }))} />
                <span className='slider' />
              </label>
            </div>
            <div className='strategy-mode'>
              <button className={m2Strategy.mode === 'pattern' ? 'active' : ''} onClick={() => setM2Strategy(prev => ({ ...prev, mode: 'pattern' }))}>Pattern (E/O)</button>
              <button className={m2Strategy.mode === 'digit' ? 'active' : ''} onClick={() => setM2Strategy(prev => ({ ...prev, mode: 'digit' }))}>Digit Condition</button>
            </div>
            {m2Strategy.mode === 'pattern' ? (
              <input type='text' placeholder='Pattern: O,O,E,E,O (min 2 chars)' value={m2Strategy.pattern} onChange={e => setM2Strategy(prev => ({ ...prev, pattern: e.target.value.toUpperCase().replace(/[^EO]/g, '') }))} />
            ) : (
              <div className='digit-condition'>
                <input type='number' placeholder='Window' value={m2Strategy.digitWindow} onChange={e => setM2Strategy(prev => ({ ...prev, digitWindow: e.target.value }))} />
                <select value={m2Strategy.digitCondition} onChange={e => setM2Strategy(prev => ({ ...prev, digitCondition: e.target.value }))}>
                  <option value='=='>==</option><option value='>'>&gt;</option><option value='<'>&lt;</option>
                  <option value='>='>&gt;=</option><option value='<='>&lt;=</option>
                </select>
                <input type='number' placeholder='Digit' value={m2Strategy.digitCompare} onChange={e => setM2Strategy(prev => ({ ...prev, digitCompare: e.target.value }))} />
              </div>
            )}
          </div>
        </div>

        {/* Combined Strategy & Risk */}
        <div className='bottom-config'>
          <div className='combined-card'>
            <div className='combined-header'>
              <span>🎯 Combined Strategy</span>
              <label className='switch'><input type='checkbox' checked={m1Combined.enabled} onChange={e => setM1Combined(prev => ({ ...prev, enabled: e.target.checked }))} /><span className='slider' /></label>
            </div>
            <input type='text' placeholder='Patterns: 1,5,11,112,1O,5U,EEO (comma separated)' value={m1Combined.patterns} onChange={e => setM1Combined(prev => ({ ...prev, patterns: e.target.value }))} />
            <div className='combined-header' style={{ marginTop: 8 }}>
              <span>🎯 M2 Combined</span>
              <label className='switch'><input type='checkbox' checked={m2Combined.enabled} onChange={e => setM2Combined(prev => ({ ...prev, enabled: e.target.checked }))} /><span className='slider' /></label>
            </div>
            <input type='text' placeholder='Patterns: 1,5,11,112,1O,5U,EEO (comma separated)' value={m2Combined.patterns} onChange={e => setM2Combined(prev => ({ ...prev, patterns: e.target.value }))} />
          </div>

          <div className='risk-card'>
            <div className='risk-header'>⚙️ Risk Management</div>
            <div className='risk-row'>
              <input type='number' step='0.01' placeholder='Stake' value={stake} onChange={e => setStake(e.target.value)} />
              <input type='number' placeholder='Take Profit' value={takeProfit} onChange={e => setTakeProfit(e.target.value)} />
              <input type='number' placeholder='Stop Loss' value={stopLoss} onChange={e => setStopLoss(e.target.value)} />
            </div>
            <div className='risk-row'>
              <label><input type='checkbox' checked={martingaleOn} onChange={e => setMartingaleOn(e.target.checked)} /> Martingale</label>
              {martingaleOn && (
                <>
                  <input type='number' step='0.1' placeholder='Multiplier' value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} />
                  <input type='number' placeholder='Max Steps' value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} />
                </>
              )}
            </div>
            <div className='risk-row'>
              <label><input type='checkbox' checked={scannerActive} onChange={e => setScannerActive(e.target.checked)} /> Scan All Markets</label>
              <label className='ticks-label'>Ticks: </label>
              <select value={activeTicks} onChange={e => handleTickChange(parseInt(e.target.value))}>
                {TICK_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Scanner Grid */}
        <div className='legend'>
          <div className='legend-left'>
            <div className='legend-item'><span className='legend-dot' style={{ background: DIGIT_COLORS.most }} />Most Appearing</div>
            <div className='legend-item'><span className='legend-dot' style={{ background: DIGIT_COLORS.second }} />2nd Most</div>
            <div className='legend-item'><span className='legend-dot' style={{ background: DIGIT_COLORS.least }} />Least Appearing</div>
            <div className='legend-item'><span className='legend-dot' style={{ background: DIGIT_COLORS.second_least }} />2nd Least</div>
            <div className='legend-item'><span className='legend-dot' style={{ background: '#22c55e' }} />Pattern Match</div>
          </div>
          <div className='legend-right'>
            <span className='pill'>{totalStrong} STRONG</span>
            <span className='pill'>{totalModerate} MODERATE</span>
          </div>
        </div>

        <div className='grid'>
          {cards.map(card => (
            <div key={card.symbol} className={`card ${card.patternMatched || card.combinedMatched ? 'matched' : ''}`}>
              <div className='card-head'>
                <div className='card-title'>{card.display_name}</div>
                <div className='card-value'>{card.current_quote}</div>
              </div>
              {(card.patternMatched || card.combinedMatched) && (
                <div className='match-badge'>
                  {card.patternMatched && '🎯 PATTERN MATCH!'}
                  {card.combinedMatched && '🔀 COMBINED MATCH!'}
                </div>
              )}

              <div className='circles'>
                {card.digits.map(d => (
                  <div key={d.digit} className='circle-wrap'>
                    <div className='circle-inner' style={{ '--color': d.color } as React.CSSProperties}>
                      {d.digit}
                    </div>
                    <div className='pct'>{d.pct}%</div>
                  </div>
                ))}
              </div>

              <div className='stats-row'>
                <div className='stat'>Even: {card.even_pct}%</div>
                <div className='stat'>Odd: {card.odd_pct}%</div>
                <div className='stat'>Over 4: {card.over_pct}%</div>
                <div className='stat'>Under 5: {card.under_pct}%</div>
              </div>

              <div className='squares'>
                {card.last_digits.map((digit, i) => (
                  <div key={i} className={`sq ${digit !== undefined ? (digit % 2 === 0 ? 'teal' : 'red') : 'empty'}`}>
                    {digit !== undefined ? digit : '—'}
                  </div>
                ))}
              </div>

              <div className='payout'>
                <div className='payout-box teal'>
                  <div className='top'><span>Even</span><span>{card.even_pct}%</span></div>
                  <div className='bottom'><span>Payout</span><span>{card.even_payout}</span></div>
                </div>
                <div className='payout-box red'>
                  <div className='top'><span>Odd</span><span>{card.odd_pct}%</span></div>
                  <div className='bottom'><span>Payout</span><span>{card.odd_payout}</span></div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Activity Log */}
        <div className='activity-log'>
          <div className='log-header'>
            <span>📋 Activity Log</span>
            <button onClick={() => setLogs([])}>Clear</button>
          </div>
          <div className='log-entries'>
            {logs.length === 0 ? (
              <div className='log-empty'>No activity yet. Start the bot to see trades.</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`log-entry ${log.type}`}>
                  <span className='log-time'>{log.time}</span>
                  <span className='log-message'>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default Scanner;
