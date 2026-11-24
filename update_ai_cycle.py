"""Fetch public Treasury yield observations; never synthesize missing data."""
import csv, io, json, pathlib, urllib.request, datetime
URL="https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"
def collect():
    with urllib.request.urlopen(URL, timeout=30) as response:
        rows=list(csv.DictReader(io.StringIO(response.read().decode())))
    vals=[]
    for row in rows:
        try:
            date=datetime.date.fromisoformat(row.get("observation_date",row.get("DATE","")))
            value=float(row["DGS10"])
            if 0<=value<=30: vals.append((date,value))
        except (ValueError,KeyError,TypeError): continue
    vals.sort()
    date,value=vals[-1]
    prior=next((x for x in reversed(vals) if x[0]<=date-datetime.timedelta(days=7)),None)
    if prior is None: raise ValueError("No comparison observation")
    return {"yield":{"current":value,"previous":prior[1],"date":date.isoformat(),"source":"FRED DGS10 / "+prior[0].isoformat()+" 비교"}}

def facts(cik):
    url=f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
    req=urllib.request.Request(url,headers={"User-Agent":"DCA Winner research contact https://github.com/13-23/dca_winner"})
    with urllib.request.urlopen(req,timeout=30) as response:
        return json.load(response)["facts"]["us-gaap"]

def series(f, tags, flow=False):
    for tag in tags:
        rows=f.get(tag,{}).get("units",{}).get("USD",[])
        out={}
        for r in rows:
            if r.get("form") not in ("10-K","10-Q"): continue
            if flow and (not r.get("start") or not 350<= (datetime.date.fromisoformat(r["end"])-datetime.date.fromisoformat(r["start"])).days<=380): continue
            if not flow and r.get("start"): continue
            k=r["end"]
            if k not in out or r["filed"]>=out[k]["filed"]: out[k]=r
        if out: return {k:v["val"] for k,v in out.items()}
    raise ValueError("Missing SEC fact: "+str(tags))

def nv():
    f=facts(1045810)
    rev=series(f,["RevenueFromContractWithCustomerExcludingAssessedTax","SalesRevenueNet"],True)
    result={}
    for key,tags in [("inventory",["InventoryNet"]),("receivables",["AccountsReceivableNetCurrent"])]:
        s=series(f,tags)
        dates=sorted(set(s)&set(rev))
        if len(dates)<3: raise ValueError("Insufficient annual comparisons")
        a,b,c=dates[-3:]
        if any(not 350<=(datetime.date.fromisoformat(y)-datetime.date.fromisoformat(x)).days<=380 for x,y in [(a,b),(b,c)]): raise ValueError("Nonannual comparison")
        def gap(x,y): return 100*(s[y]/s[x]-rev[y]/rev[x])
        result[key]={"current":gap(b,c),"previous":gap(a,b),"date":c,"source":"SEC NVIDIA annual companyfacts; "+b+" vs "+a}
    return result

if __name__=="__main__":
    p=pathlib.Path("data/ai-cycle.json")
    p.parent.mkdir(exist_ok=True)
    old=json.loads(p.read_text()) if p.exists() else {}
    status={}
    for keys,fn in [(("yield",),collect),(("inventory","receivables"),nv)]:
        try:
            old.update(fn())
            for key in keys: status[key]="ok"
        except Exception as exc:
            for key in keys: status[key]="failed: "+str(exc)[:200]
            print(keys,exc)
    old["_status"]=status
    old["_attempted"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
    p.write_text(json.dumps(old,ensure_ascii=False)+"\n",encoding="utf-8")
