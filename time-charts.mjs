export function timeShares(result){
 const entries=[...result.projects.map(p=>({id:p.id,name:p.name,color:p.color,seconds:p.total})),{id:'conflict',name:'Needs review',color:'#edb96d',seconds:result.conflict},{id:'unassigned',name:'Not assigned',color:'#566171',seconds:result.unassigned}].filter(p=>p.seconds>0);
 const total=entries.reduce((n,p)=>n+p.seconds,0);return entries.map(p=>({...p,percent:p.seconds/total*100}));
}
export function renderTimeCharts(result){
 let panel=document.getElementById('time-breakdown');
 if(!panel){panel=document.createElement('section');panel.id='time-breakdown';panel.className='timeline-panel';panel.innerHTML='<div class="section-heading"><h2>Active-time breakdown</h2><span class="muted">Proportions of the totals above</span></div><div id="share-bar" aria-label="Active-time proportions"></div><div id="share-legend"></div>';document.querySelector('.timeline-panel').before(panel);
  const hint=document.createElement('p');hint.className='muted';hint.textContent='Clock time across the selected period. Dark areas are idle, untracked, or future time.';document.getElementById('timeline').before(hint);
 }
 const shares=timeShares(result),bar=document.getElementById('share-bar'),legend=document.getElementById('share-legend');bar.replaceChildren();legend.replaceChildren();
 for(const item of shares){const sec=Math.round(item.seconds),duration=`${Math.floor(sec/3600)}h ${Math.floor(sec%3600/60)}m ${sec%60}s`,label=`${item.name} · ${duration} · ${item.percent.toFixed(1)}%`;
  const block=document.createElement(item.id==='unassigned'?'button':'span');block.className='share-segment';block.style.width=item.percent+'%';block.style.backgroundColor=item.color;block.title=label;block.dataset.project=item.id;block.setAttribute('aria-label',label);
  if(item.id==='unassigned'){block.type='button';block.onclick=()=>document.getElementById('unassigned').parentElement.click();}
  bar.append(block);const text=document.createElement('span');text.className='legend-item';const chip=document.createElement('span');chip.className='chip';chip.style.backgroundColor=item.color;text.append(chip,document.createTextNode(label));legend.append(text);
 }
 if(!shares.length)legend.textContent='No active time in this period.';
}