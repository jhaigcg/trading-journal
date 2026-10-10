//+------------------------------------------------------------------+
//|  LedgerSync.mq4                                                  |
//|  Sends this MT4 account's trades to your Ledger journal.         |
//|                                                                  |
//|  - Uploads your full order history the first time it runs, then  |
//|    only new/changed orders.                                      |
//|  - Sends open positions, balance and equity as a heartbeat.      |
//|  - Never places, modifies or closes orders. It only READS.       |
//|  - Safe to restart: the server ignores anything it already has.  |
//|                                                                  |
//|  SETUP (once):                                                   |
//|   1. Tools > Options > Expert Advisors > tick "Allow WebRequest  |
//|      for listed URL" and add your app address (shown on the     |
//|      Accounts page), e.g. https://your-app.vercel.app            |
//|   2. In the Terminal window > Account History tab, right-click   |
//|      > "All History" so MT4 loads your whole history.            |
//|   3. Drag this EA onto ANY chart, paste your token into the      |
//|      "Token" input, and make sure "AutoTrading" is on.           |
//+------------------------------------------------------------------+
#property copyright "Ledger"
#property link      ""
#property version   "1.00"
#property strict

input string ServerUrl        = "https://YOUR-APP.vercel.app/api/ingest/mt4"; // Ledger endpoint (pre-filled when downloaded from the app)
input string Token            = "";   // Token shown once on the Accounts page
input int    PollSeconds      = 10;   // How often to look for new trades
input int    HeartbeatSeconds = 300;  // Send balance + open positions at least this often
input int    BatchSize        = 100;  // Orders per request while uploading history
input int    OverlapDays      = 3;    // Re-send this many days before the last upload (harmless, the server de-duplicates)

string   gKeyLast         = "";
datetime gLastHeartbeat   = 0;
int      gLastHistoryTotal = -1;
string   gLastOpenSig     = "";
string   gStatus          = "starting";
datetime gLastOk          = 0;

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(Token) < 10)
     {
      Alert("LedgerSync: paste your token into the EA's Token input (Inputs tab).");
      return(INIT_PARAMETERS_INCORRECT);
     }
   if(StringFind(ServerUrl, "https://") != 0)
     {
      Alert("LedgerSync: ServerUrl must start with https://");
      return(INIT_PARAMETERS_INCORRECT);
     }
   gKeyLast = "LedgerSync_last_" + IntegerToString(AccountNumber());
   gStatus = "running";
   ShowStatus();
   EventSetTimer(MathMax(PollSeconds, 5));
   OnTimer();
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTick() { }   // all work happens on the timer so it also runs on weekends

//+------------------------------------------------------------------+
void OnTimer()
  {
   if(!IsConnected())
     {
      gStatus = "MT4 is not connected to the broker";
      ShowStatus();
      return;
     }

   int    histTotal = OrdersHistoryTotal();
   string sig       = OpenSignature();

   bool historyChanged = (histTotal != gLastHistoryTotal);
   bool openChanged    = (sig != gLastOpenSig);
   bool heartbeatDue   = (TimeLocal() - gLastHeartbeat >= HeartbeatSeconds);
   if(!historyChanged && !openChanged && !heartbeatDue)
      return;

   if(historyChanged)
     {
      if(!UploadHistory())
         return;                       // failed: try again on the next timer
      gLastHistoryTotal = histTotal;
     }

   if(SendSnapshot())
     {
      gLastOpenSig   = sig;
      gLastHeartbeat = TimeLocal();
     }
  }

//+------------------------------------------------------------------+
//| Upload closed orders (and deposits/withdrawals) in batches        |
//+------------------------------------------------------------------+
bool UploadHistory()
  {
   double lastStored = 0;
   if(GlobalVariableCheck(gKeyLast))
      lastStored = GlobalVariableGet(gKeyLast);
   datetime last  = (datetime)(int)lastStored;
   datetime since = (last > 0) ? (last - OverlapDays * 86400) : 0;

   int      total    = OrdersHistoryTotal();
   string   batch    = "";
   int      count    = 0;
   int      sent     = 0;
   datetime maxClose = last;

   for(int i = 0; i < total; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;
      int ty = OrderType();
      if(ty > OP_SELL && ty != 6 && ty != 7)
         continue;                     // 2..5 are cancelled/pending orders: not trades
      datetime ct = OrderCloseTime();
      if(ct == 0)
         continue;
      if(ct < since)
         continue;

      if(count > 0)
         batch += ",";
      batch += OrderJson(false);
      count++;
      if(ct > maxClose)
         maxClose = ct;

      if(count >= BatchSize)
        {
         if(!Post(BuildPayload(batch, "")))
            return(false);
         sent += count;
         gStatus = "uploading history: " + IntegerToString(sent) + " orders sent";
         ShowStatus();
         batch = "";
         count = 0;
        }
     }

   if(count > 0)
     {
      if(!Post(BuildPayload(batch, "")))
         return(false);
      sent += count;
     }

   GlobalVariableSet(gKeyLast, (double)maxClose);
   if(sent > 0)
      Print("LedgerSync: uploaded ", sent, " history orders");
   return(true);
  }

//+------------------------------------------------------------------+
//| Open positions + balance/equity (also acts as the heartbeat)      |
//+------------------------------------------------------------------+
bool SendSnapshot()
  {
   string open = "";
   int    n    = 0;
   for(int i = 0; i < OrdersTotal(); i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if(OrderType() > OP_SELL)
         continue;                     // skip pending orders
      if(n > 0)
         open += ",";
      open += OrderJson(true);
      n++;
     }
   return(Post(BuildPayload("", "[" + open + "]")));
  }

string OpenSignature()
  {
   string sig = "";
   int    n   = 0;
   for(int i = 0; i < OrdersTotal(); i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if(OrderType() > OP_SELL)
         continue;
      sig += "|" + IntegerToString(OrderTicket()) + ":" + DoubleToString(OrderStopLoss(), 5) + ":" +
             DoubleToString(OrderTakeProfit(), 5) + ":" + DoubleToString(OrderLots(), 3);
      n++;
     }
   return(IntegerToString(n) + sig);
  }

//+------------------------------------------------------------------+
//| JSON helpers                                                     |
//+------------------------------------------------------------------+
string JsonEscape(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\t", " ");
   return(s);
  }

// The order currently selected with OrderSelect()
string OrderJson(bool isOpen)
  {
   string s = "{";
   s += "\"t\":\"" + IntegerToString(OrderTicket()) + "\"";
   s += ",\"ty\":" + IntegerToString(OrderType());
   s += ",\"ot\":" + IntegerToString((int)OrderOpenTime());
   s += ",\"ct\":" + IntegerToString(isOpen ? 0 : (int)OrderCloseTime());
   s += ",\"op\":" + DoubleToString(OrderOpenPrice(), 5);
   s += ",\"cp\":" + DoubleToString(isOpen ? 0.0 : OrderClosePrice(), 5);
   s += ",\"l\":" + DoubleToString(OrderLots(), 3);
   s += ",\"s\":\"" + JsonEscape(OrderSymbol()) + "\"";
   s += ",\"p\":" + DoubleToString(OrderProfit(), 2);
   s += ",\"sw\":" + DoubleToString(OrderSwap(), 2);
   s += ",\"cm\":" + DoubleToString(OrderCommission(), 2);
   s += ",\"sl\":" + DoubleToString(OrderStopLoss(), 5);
   s += ",\"tp\":" + DoubleToString(OrderTakeProfit(), 5);
   s += ",\"c\":\"" + JsonEscape(OrderComment()) + "\"";
   s += ",\"m\":" + IntegerToString(OrderMagicNumber());
   s += "}";
   return(s);
  }

// Server clock offset from GMT in seconds, or "null" when the last tick is stale (e.g. weekend)
string OffsetJson()
  {
   int raw     = (int)(TimeCurrent() - TimeGMT());
   int rounded = (int)(MathRound(raw / 900.0) * 900);
   if(MathAbs(raw - rounded) <= 120)
      return(IntegerToString(rounded));
   return("null");
  }

string BuildPayload(string ordersCsv, string openArray)
  {
   string p = "{\"v\":1";
   p += ",\"login\":\"" + IntegerToString(AccountNumber()) + "\"";
   p += ",\"server\":\"" + JsonEscape(AccountServer()) + "\"";
   p += ",\"company\":\"" + JsonEscape(AccountCompany()) + "\"";
   p += ",\"currency\":\"" + JsonEscape(AccountCurrency()) + "\"";
   p += ",\"balance\":" + DoubleToString(AccountBalance(), 2);
   p += ",\"equity\":" + DoubleToString(AccountEquity(), 2);
   p += ",\"offsetSec\":" + OffsetJson();
   p += ",\"orders\":[" + ordersCsv + "]";
   if(StringLen(openArray) > 0)
      p += ",\"open\":" + openArray;
   p += "}";
   return(p);
  }

//+------------------------------------------------------------------+
//| HTTP                                                             |
//+------------------------------------------------------------------+
string BaseUrl()
  {
   int p = StringFind(ServerUrl, "/", 8);
   return((p > 0) ? StringSubstr(ServerUrl, 0, p) : ServerUrl);
  }

bool Post(string body)
  {
   char   data[];
   char   result[];
   string resHeaders;
   int    len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;   // drop the trailing zero
   if(len < 0)
      len = 0;
   ArrayResize(data, len);

   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + Token + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", ServerUrl, headers, 30000, data, result, resHeaders);
   if(code == -1)
     {
      int err = GetLastError();
      if(err == 4060)
         gStatus = "BLOCKED: add " + BaseUrl() + " under Tools > Options > Expert Advisors > Allow WebRequest";
      else
         gStatus = "network error " + IntegerToString(err) + " (will retry)";
      Print("LedgerSync: ", gStatus);
      ShowStatus();
      return(false);
     }

   string resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(code == 200)
     {
      gLastOk = TimeLocal();
      gStatus = "connected";
      ShowStatus();
      return(true);
     }
   if(code == 401)
      gStatus = "REJECTED: the token is wrong or was regenerated";
   else if(code == 409)
      gStatus = "REJECTED: this token belongs to a different MT4 account number";
   else
      gStatus = "server error " + IntegerToString(code) + ": " + StringSubstr(resp, 0, 120);
   Print("LedgerSync: ", gStatus);
   ShowStatus();
   return(false);
  }

void ShowStatus()
  {
   string last = (gLastOk > 0) ? TimeToString(gLastOk, TIME_DATE | TIME_SECONDS) : "never";
   Comment("LedgerSync  v1.00\n",
           "Account: ", AccountNumber(), "  ", AccountServer(), "\n",
           "Status: ", gStatus, "\n",
           "Last successful send: ", last);
  }
//+------------------------------------------------------------------+
