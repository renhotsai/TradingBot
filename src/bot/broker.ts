import { timeframeString, type InstrumentConfig } from "@/config";
import type { Candle, Direction } from "./strategies/types";

export interface AccountInfo {
  equity: number;
  buyingPower: number;
}

export interface OrderResult {
  orderId: string;
  /** Average fill price when the order filled during our short poll, else null. */
  filledAvgPrice: number | null;
  /** Actual filled quantity when the order filled during our short poll, else
   * null — crypto fills can differ slightly from the requested quantity, so
   * callers should use this instead of assuming the request was filled exactly. */
  filledQty: number | null;
}

export interface OrderStatus {
  orderId: string;
  status: string;
  filledAvgPrice: number | null;
  filledQty: number | null;
}

export interface BrokerPosition {
  symbol: string;
  side: Direction;
  qty: number;
  avgEntryPrice: number;
}

export interface Broker {
  getAccount(): Promise<AccountInfo>;
  isMarketOpen(): Promise<boolean>;
  getBars(instrument: InstrumentConfig): Promise<Candle[]>;
  getLatestPrice(instrument: InstrumentConfig): Promise<number>;
  submitMarketOrder(
    instrument: InstrumentConfig,
    side: "buy" | "sell",
    qty: number,
    clientOrderId: string,
  ): Promise<OrderResult>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;
  /** Looks an order up by the client_order_id it was submitted with — the
   * only way to find it again if the response to the initial submit was
   * lost before a broker order id could be captured. Null if unknown. */
  getOrderByClientOrderId(clientOrderId: string): Promise<OrderStatus | null>;
  /** The account's real positions, straight from the broker — the source of
   * truth the engine checks itself against before opening a new position and
   * right after every fill, rather than trusting its own records alone. */
  getOpenPositions(): Promise<BrokerPosition[]>;
  getOpenPosition(symbol: string): Promise<BrokerPosition | null>;
}

const DATA_URL = "https://data.alpaca.markets";
const RETRY_DELAYS_MS = [2000, 4000, 8000];

/**
 * Alpaca's orders/bars/trades endpoints take crypto symbols with the slash
 * (BTC/USD), but the positions endpoints identify crypto positions without
 * it (BTCUSD) — normalize before comparing or building a positions URL.
 */
export function normalizeSymbol(symbol: string): string {
  return symbol.replace("/", "");
}

/**
 * All broker methods append their own /v2/... path, so tolerate base URLs
 * configured with a trailing slash and/or /v2 suffix (a common mistake:
 * APCA_API_BASE_URL=https://paper-api.alpaca.markets/v2 would otherwise
 * produce doubled /v2/v2/ URLs and 404s).
 */
export function normalizeAlpacaBaseUrl(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v2$/, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AlpacaBroker implements Broker {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  /** Stock data feed; "iex" is available on the free plan, "sip" needs a subscription. */
  private readonly stockFeed: string;

  constructor(opts?: { keyId?: string; secretKey?: string; baseUrl?: string; stockFeed?: string }) {
    const keyId = opts?.keyId ?? process.env.APCA_API_KEY_ID ?? "";
    const secretKey = opts?.secretKey ?? process.env.APCA_API_SECRET_KEY ?? "";
    this.baseUrl = normalizeAlpacaBaseUrl(
      opts?.baseUrl ??
        process.env.APCA_API_BASE_URL ??
        "https://paper-api.alpaca.markets",
    );
    this.stockFeed = opts?.stockFeed ?? process.env.ALPACA_DATA_FEED ?? "iex";
    this.headers = {
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secretKey,
      "Content-Type": "application/json",
    };
  }

  /**
   * Fetch with exponential backoff (2s/4s/8s) on network failures, 429s and
   * 5xx responses. Other 4xx responses (bad keys, bad request) fail fast.
   */
  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await fetch(url, { ...init, headers: this.headers });
        if (res.ok) return (await res.json()) as T;
        const body = await res.text();
        const err = new Error(`Alpaca ${res.status} ${url}: ${body.slice(0, 300)}`);
        if (res.status === 429 || res.status >= 500) throw err;
        // Non-retryable client error (auth, validation) — surface immediately.
        return Promise.reject(err);
      } catch (e) {
        lastError = e;
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError;
  }

  async getAccount(): Promise<AccountInfo> {
    const acct = await this.request<{ equity: string; buying_power: string }>(
      `${this.baseUrl}/v2/account`,
    );
    return {
      equity: parseFloat(acct.equity),
      buyingPower: parseFloat(acct.buying_power),
    };
  }

  async isMarketOpen(): Promise<boolean> {
    const clock = await this.request<{ is_open: boolean }>(
      `${this.baseUrl}/v2/clock`,
    );
    return clock.is_open;
  }

  async getBars(instrument: InstrumentConfig): Promise<Candle[]> {
    const tf = timeframeString(instrument.timeframeMinutes);
    const limit = instrument.barsToFetch;
    // Generous lookback so `limit` bars exist even across closed market hours,
    // combined with sort=desc so we get the *newest* bars, then re-sort ascending.
    const calendarFactor = instrument.assetClass === "crypto" ? 1.5 : 8;
    const start = new Date(
      Date.now() - instrument.timeframeMinutes * 60_000 * limit * calendarFactor,
    ).toISOString();

    type RawBar = { t: string; o: number; h: number; l: number; c: number; v: number };
    let raw: RawBar[];
    if (instrument.assetClass === "crypto") {
      const url =
        `${DATA_URL}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(instrument.symbol)}` +
        `&timeframe=${tf}&start=${encodeURIComponent(start)}&limit=${limit}&sort=desc`;
      const data = await this.request<{ bars: Record<string, RawBar[]> }>(url);
      raw = data.bars[instrument.symbol] ?? [];
    } else {
      const url =
        `${DATA_URL}/v2/stocks/${encodeURIComponent(instrument.symbol)}/bars` +
        `?timeframe=${tf}&start=${encodeURIComponent(start)}&limit=${limit}` +
        `&adjustment=raw&feed=${this.stockFeed}&sort=desc`;
      const data = await this.request<{ bars: RawBar[] | null }>(url);
      raw = data.bars ?? [];
    }

    return raw
      .map((b) => ({
        time: b.t,
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      }))
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  async getLatestPrice(instrument: InstrumentConfig): Promise<number> {
    if (instrument.assetClass === "crypto") {
      const url = `${DATA_URL}/v1beta3/crypto/us/latest/trades?symbols=${encodeURIComponent(instrument.symbol)}`;
      const data = await this.request<{ trades: Record<string, { p: number }> }>(url);
      const trade = data.trades[instrument.symbol];
      if (!trade) throw new Error(`No latest trade for ${instrument.symbol}`);
      return trade.p;
    }
    const url = `${DATA_URL}/v2/stocks/${encodeURIComponent(instrument.symbol)}/trades/latest?feed=${this.stockFeed}`;
    const data = await this.request<{ trade: { p: number } }>(url);
    return data.trade.p;
  }

  async submitMarketOrder(
    instrument: InstrumentConfig,
    side: "buy" | "sell",
    qty: number,
    clientOrderId: string,
  ): Promise<OrderResult> {
    const order = await this.request<{ id: string; filled_avg_price: string | null }>(
      `${this.baseUrl}/v2/orders`,
      {
        method: "POST",
        body: JSON.stringify({
          symbol: instrument.symbol,
          qty: String(qty),
          side,
          type: "market",
          time_in_force: instrument.assetClass === "crypto" ? "gtc" : "day",
          client_order_id: clientOrderId,
        }),
      },
    );

    // Market orders usually fill in well under a second — poll briefly for the
    // real fill price so trade logs are accurate; fall back to latest price.
    for (let i = 0; i < 3; i++) {
      await sleep(700);
      const status = await this.getOrderStatus(order.id);
      if (status.filledAvgPrice !== null) {
        return { orderId: order.id, filledAvgPrice: status.filledAvgPrice, filledQty: status.filledQty };
      }
      if (["canceled", "expired", "rejected"].includes(status.status)) {
        throw new Error(`Order ${order.id} for ${instrument.symbol} ${status.status}`);
      }
    }
    return { orderId: order.id, filledAvgPrice: null, filledQty: null };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const raw = await this.request<{
      id: string;
      status: string;
      filled_avg_price: string | null;
      filled_qty: string | null;
    }>(`${this.baseUrl}/v2/orders/${orderId}`);
    return {
      orderId: raw.id,
      status: raw.status,
      filledAvgPrice: raw.filled_avg_price ? parseFloat(raw.filled_avg_price) : null,
      filledQty: raw.filled_qty ? parseFloat(raw.filled_qty) : null,
    };
  }

  async getOrderByClientOrderId(clientOrderId: string): Promise<OrderStatus | null> {
    try {
      const raw = await this.request<{
        id: string;
        status: string;
        filled_avg_price: string | null;
        filled_qty: string | null;
      }>(`${this.baseUrl}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`);
      return {
        orderId: raw.id,
        status: raw.status,
        filledAvgPrice: raw.filled_avg_price ? parseFloat(raw.filled_avg_price) : null,
        filledQty: raw.filled_qty ? parseFloat(raw.filled_qty) : null,
      };
    } catch {
      return null;
    }
  }

  async getOpenPositions(): Promise<BrokerPosition[]> {
    const raw = await this.request<
      { symbol: string; side: string; qty: string; avg_entry_price: string }[]
    >(`${this.baseUrl}/v2/positions`);
    return raw.map((p) => ({
      symbol: p.symbol,
      side: p.side === "short" ? "short" : "long",
      qty: Math.abs(parseFloat(p.qty)),
      avgEntryPrice: parseFloat(p.avg_entry_price),
    }));
  }

  async getOpenPosition(symbol: string): Promise<BrokerPosition | null> {
    try {
      const p = await this.request<{
        symbol: string;
        side: string;
        qty: string;
        avg_entry_price: string;
      }>(`${this.baseUrl}/v2/positions/${encodeURIComponent(normalizeSymbol(symbol))}`);
      return {
        // Return the symbol the caller asked about (canonical, with slash for
        // crypto) rather than Alpaca's own compact form, so callers can use
        // it directly against InstrumentConfig.symbol without translating.
        symbol,
        side: p.side === "short" ? "short" : "long",
        qty: Math.abs(parseFloat(p.qty)),
        avgEntryPrice: parseFloat(p.avg_entry_price),
      };
    } catch {
      return null;
    }
  }
}

export function directionToCloseSide(direction: Direction): "buy" | "sell" {
  return direction === "long" ? "sell" : "buy";
}
