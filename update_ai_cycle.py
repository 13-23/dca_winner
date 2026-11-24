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
if __name__=="__main__":
    try:
        result=collect()
        p=pathlib.Path("data/ai-cycle.json")
        p.parent.mkdir(exist_ok=True)
        p.write_text(json.dumps(result,ensure_ascii=False)+"\n",encoding="utf-8")
    except Exception as exc:
        print("AI data unavailable; preserving prior file:",exc)
