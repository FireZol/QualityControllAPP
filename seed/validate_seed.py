import json, math
d=json.load(open('fise_tehnice_initiale.json')); iec=json.load(open('iec60228_2023.json'))
K=d['constante_material']; issues=[]
def add(level,where,msg): issues.append((level,where,msg))
area=lambda dd: math.pi/4*dd*dd
# wires
for w in d['sarma_trefilata']:
    n=f"Sârmă {w['material']} {w['destinatie'] or ''} {w['denumire']}".replace('  ',' ')
    if not (w['d_min']<=w['d_nom']<=w['d_max']): add('A',n,f"Ø nominal {w['d_nom']} în afara min–max {w['d_min']}–{w['d_max']}")
    if w['masa_min_kg_km']>=w['masa_max_kg_km']: add('A',n,'masă min ≥ max')
    lo,hi=w['d_nom']-w['d_min'],w['d_max']-w['d_nom']
    if abs(lo-hi)>0.004: add('B',n,f"toleranță Ø asimetrică: −{lo:.3f} / +{hi:.3f} mm")
    try: fil=float(w['filiera'].split('/')[0])
    except: fil=None
    if fil and fil<=w['d_nom']: add('A',n,f"filiera {fil} ≤ Ø sârmă {w['d_nom']}")
    m_th=area(w['d_nom'])*K[w['material']]['densitate_g_cm3']
    mid=(w['masa_min_kg_km']+w['masa_max_kg_km'])/2
    if abs(mid/m_th-1)>0.02:
        tot=m_th*w['nr_fire_conductor']
        extra=f" (pare masa întregului conductor: {w['nr_fire_conductor']} × {m_th:.2f} = {tot:.2f})" if abs(mid/tot-1)<0.03 else ''
        add('A',n,f"masă {w['masa_min_kg_km']}–{w['masa_max_kg_km']} kg/km vs teoretic {m_th:.2f} kg/km pentru Ø {w['d_nom']}{extra}")
    mmin_th=area(w['d_min'])*K[w['material']]['densitate_g_cm3']; mmax_th=area(w['d_max'])*K[w['material']]['densitate_g_cm3']
# strands
wires={(w['material'],w['sectiune'],f):w for w in d['sarma_trefilata'] for f in w['forme'] if (w['material']=='Al' and w['destinatie'] is None) or (w['material']=='Cu' and w['destinatie']=='Multifilar')}
c2={r['sectiune']:r for r in iec['class2']}
for f in d['funie_rigida']:
    n=f"Funie {f['material']} {f['denumire']}"
    mw=area(f['d_fir'])*K[f['material']]['densitate_g_cm3']*f['nr_fire']
    mid=(f['masa_min_g_m']+f['masa_max_g_m'])/2; lay=mid/mw
    f['_raport_compactare']=round(lay,3)
    if not 0.88<=lay<=1.05: add('A',n,f"masă funie {mid:.1f} g/m / (nr. fire × masă fir {mw:.1f}) = {lay:.3f}, în afara plajei plauzibile 0,88–1,05")
    fk='RMC' if f['forma']=='RMC' else f['forma'][:2]
    key={'RM':'compactat','RMC':'compactat','SM':'profilat'}[fk]
    if fk=='RM' and f['sectiune'] in c2:
        mc=c2[f['sectiune']]['fire_min']['circular'][f['material'].lower()]
        if mc and f['nr_fire']<mc: add('C',n,f"marcat RM (nu RMC): dacă nu este compactat, IEC cere minim {mc} fire circular; cu {f['nr_fire']} fire este conform doar ca și compactat (minim {c2[f['sectiune']]['fire_min']['compactat'][f['material'].lower()]})")
    mn=c2[f['sectiune']]['fire_min'][key][f['material'].lower()] if f['sectiune'] in c2 else None
    if mn and f['nr_fire']<mn: add('A',n,f"{f['nr_fire']} fire < minim IEC {mn} ({key})")
    if f['material']=='Al' and fk=='RM' and f['sectiune']>35 : pass
    # wire table cross-check
    wshape=('RM' if fk in('RM','RMC') else (f['forma'] if f['material']=='Al' else 'SM'))
    w=wires.get((f['material'],f['sectiune'],wshape))
    if w and abs(w['d_nom']-f['d_fir'])>0.001: add('B',n,f"Ø fir {f['d_fir']} ≠ anexa A6 ({w['denumire']}: {w['d_nom']})")
    if w and w['nr_fire_conductor']!=f['nr_fire']: add('B',n,f"nr. fire {f['nr_fire']} ≠ anexa A6 ({w['nr_fire_conductor']})")
    if not w: add('C',n,f"nu există sârmă corespunzătoare în anexa A6 ({f['material']} {f['sectiune']} {wshape})")
    # theoretical R
    lim=c2.get(f['sectiune'],{}).get('al' if f['material']=='Al' else 'cu_simplu')
    A=f['masa_max_g_m']/K[f['material']]['densitate_g_cm3']; R=1000*K[f['material']]['rho20_ohm_mm2_m']/A
    Rmin=1000*K[f['material']]['rho20_ohm_mm2_m']/(f['masa_min_g_m']/K[f['material']]['densitate_g_cm3'])
    if lim and Rmin>lim: add('A',n,f"R teoretică la masa minimă {Rmin:.4f} Ω/km > R max IEC {lim}")
# class 5
c5={r['sectiune']:r for r in iec['class5_cu']}
for c in d['conductor_flexibil_cl5']:
    n=f"Flexibil cl.5 {c['sectiune']} mm² ({c['filiera']})"
    mw=area(c['d_sarma'])*8.89
    s_mid=(c['suvita_min_g_m']+c['suvita_max_g_m'])/2; ratio=s_mid/(mw*c['nr_fire_suvita'])
    if not 0.99<=ratio<=1.05: add('B',n,f"masă suvită {s_mid:.2f} / ({c['nr_fire_suvita']} × {mw:.3f}) = {ratio:.3f}")
    if c['nr_toroane']:
        if c['nr_toroane']*c['nr_fire_toron']!=c['nr_fire_lita']: add('A',n,f"{c['nr_toroane']} × {c['nr_fire_toron']} ≠ {c['nr_fire_lita']} fire")
        t_mid=(c['toron_min_g_m']+c['toron_max_g_m'])/2; exp=s_mid*c['nr_fire_toron']/c['nr_fire_suvita']
        if not 0.99<=t_mid/exp<=1.05: add('B',n,f"masă toron {t_mid:.3f} vs suvite {c['nr_fire_toron']}/{c['nr_fire_suvita']} × {s_mid:.2f} = {exp:.3f} (raport {t_mid/exp:.3f})")
        l_exp=t_mid*c['nr_toroane']
        if not 0.99<=c['lita_aprox_g_m']/l_exp<=1.08: add('B',n,f"masă liță {c['lita_aprox_g_m']} vs {c['nr_toroane']} × toron {t_mid:.2f} = {l_exp:.2f} (raport {c['lita_aprox_g_m']/l_exp:.3f})")
    else:
        l_exp=mw*c['nr_fire_lita']
        if not 0.99<=c['lita_aprox_g_m']/l_exp<=1.08: add('B',n,f"masă liță {c['lita_aprox_g_m']} vs {c['nr_fire_lita']} × {mw:.3f} = {l_exp:.2f} (raport {c['lita_aprox_g_m']/l_exp:.3f})")
    if c['d_sarma']>c5[c['sectiune']]['d_max_fir']: add('A',n,f"Ø fir {c['d_sarma']} > maxim IEC {c5[c['sectiune']]['d_max_fir']}")
    if c['d_sarma_lita']>c['d_sarma']: add('A',n,'Ø sârmă în liță > Ø sârmă')
    A=c['lita_aprox_g_m']/8.89; R=1000*0.01707/A; lim=c5[c['sectiune']]['cu_simplu']
    if R>lim: add('A',n,f"R teoretică {R:.4f} > R max IEC {lim}")
for e in d['conductor_extrudat_al']:
    n=f"Extrudat Al {e['denumire']}"
    if e['d_nom']:
        m=area(e['d_nom'])*2.703; mid=(e['masa_min_g_m']+e['masa_max_g_m'])/2
        if abs(mid/m-1)>0.015: add('B',n,f"masă {mid:.2f} vs teoretic Ø {e['d_nom']}: {m:.2f} g/m")
    Rmin=1000*0.0275/(e['masa_min_g_m']/2.703); lim={r['sectiune']:r for r in iec['class1']}[e['sectiune']]['al']
    if lim and Rmin>lim: add('A',n,f"R teoretică la masa minimă {Rmin:.4f} > R max IEC {lim}")
issues.sort()
for l,w,m in issues: print(l,'|',w,'|',m)
print(len(issues))
json.dump([dict(nivel=l,unde=w,problema=m) for l,w,m in issues],open('verificare_seed.json','w'),ensure_ascii=False,indent=1)
