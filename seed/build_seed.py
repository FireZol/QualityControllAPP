import json, math, sys
sys.path.insert(0,'.')
from _a6_al import AL; from _a6_cu import CU; from _a6_al2 import PURTATOR, EVN
from _cl5 import CL5_MIC, CL5_MARE; from _funii_al import AL_RMC, AL_SM; from _funii_cu import CU_RMC, CU_SM
from _sector_al import SECTOR_AL
DENS={'Cu':8.89,'Al':2.703}; RHO={'Cu':0.01707,'Al':0.0275}
out={}
def wire(mat, dest, r, src):
    return dict(material=mat,destinatie=dest,denumire=r['label'],sectiune=r['s'],forme=r['forme'],filiera=r['fil'],
                d_nom=r['dn'],d_min=r['dmin'],d_max=r['dmax'],nr_fire_conductor=r['n'],masa_min_kg_km=r['mmin'],masa_max_kg_km=r['mmax'],
                modificat=r.get('mk'),sursa=src)
W=[]
srcA6='A6 Ed.33 Rev.7 — Conductori rotunzi clasa I-II Cu si Al (23.09.2026)'
for (lab,s,f,fil,dn,dmin,dmax,n,mn,mx,red) in AL:
    W.append(wire('Al',None,dict(label=lab,s=s,forme=f,fil=str(fil),dn=dn,dmin=dmin,dmax=dmax,n=n,mmin=mn,mmax=mx,mk='rosu' if red else None),srcA6+', pag. 2/3 Aluminiu'))
for (dest,lab,s,f,fil,n,dn,dmin,dmax,mn,mx,mk) in CU:
    W.append(wire('Cu',dest,dict(label=lab,s=s,forme=[f],fil=str(fil),dn=dn,dmin=dmin,dmax=dmax,n=n,mmin=mn,mmax=mx,mk=mk),srcA6+', pag. 1/3 Cupru'))
for (lab,s,f,fil,dn,dmin,dmax,n,mn,mx,mk) in PURTATOR:
    W.append(wire('Al','Purtator',dict(label=lab,s=s,forme=[f],fil=fil,dn=dn,dmin=dmin,dmax=dmax,n=n,mmin=mn,mmax=mx,mk=mk),srcA6+', pag. 3/3 Aluminiu purtator'))
for (lab,s,f,fil,dn,dmin,dmax,n,mn,mx,mk) in EVN:
    W.append(wire('Al','EVN',dict(label=lab,s=s,forme=[f],fil=fil,dn=dn,dmin=dmin,dmax=dmax,n=n,mmin=mn,mmax=mx,mk=mk),srcA6+', pag. 3/3 Aluminiu EVN'))
out['sarma_trefilata']=W
F=[]
def rot(t):
    return None if t==(None,None) else dict(pas_mm=t[0],tensionare=t[1])
for mat,rows,rotors,src in [('Al',AL_RMC+AL_SM,[12,18,24],'Instructiuni cablare rigid — Strander 1+6+12+18+24 — Aluminiu'),
                            ('Cu',CU_RMC+CU_SM,[6,12,18],'Instructiuni cablare rigid — Strander SETIC 1+6+12+18 — Cupru')]:
    for (lab,s,f,n,d,red,r1,r2,r3,rec,dfun,mn,mx) in rows:
        dims=None
        if dfun:
            p=[float(x) for x in dfun.replace('×','x').split('x')]
            dims={'d':p[0]} if len(p)==1 else {'h':min(p),'l':max(p),'text':dfun}
        F.append(dict(material=mat,denumire=lab,sectiune=s,forma=f,nr_fire=n,d_fir=d,d_fir_modificat=bool(red),
            rotoare={str(k):rot(v) for k,v in zip(rotors,[r1,r2,r3])},tensionare_receptie=rec,
            diametru_funie=dims,diametru_funie_toleranta=('+/-0.1' if f.startswith('SM') else 'informativ'),
            masa_min_g_m=mn,masa_max_g_m=mx,clasa=2,sursa=src))
out['funie_rigida']=F
C=[]
srcC='A6 Ed.2 Rev.4 — Conductori rotunzi clasa V de cupru (07.09.2026)'
for (s,nl,fil,d,dl,ns,smin,smax,la) in CL5_MIC:
    C.append(dict(sectiune=s,nr_fire_lita=nl,nr_toroane=None,nr_fire_toron=None,filiera=fil,d_sarma=d,d_sarma_lita=dl,nr_fire_suvita=ns,
                  suvita_min_g_m=smin,suvita_max_g_m=smax,toron_min_g_m=None,toron_max_g_m=None,lita_aprox_g_m=la,destinatie='Unifilar / Multifilar',clasa=5,sursa=srcC))
for (s,nl,nt,nft,fil,d,dl,ns,smin,smax,tmin,tmax,la) in CL5_MARE:
    C.append(dict(sectiune=s,nr_fire_lita=nl,nr_toroane=nt,nr_fire_toron=nft,filiera=fil,d_sarma=d,d_sarma_lita=dl,nr_fire_suvita=ns,
                  suvita_min_g_m=smin,suvita_max_g_m=smax,toron_min_g_m=tmin,toron_max_g_m=tmax,lita_aprox_g_m=la,destinatie='Unifilar / Multifilar',clasa=5,sursa=srcC))
out['conductor_flexibil_cl5']=C
out['conductor_extrudat_al']=[dict(material='Al',denumire=l,sectiune=s,forma=f,d_nom=dn,d_min=dmin,d_max=dmax,filiera_trefilare=fil,masa_min_g_m=mn,masa_max_g_m=mx,
    h=None,l=None,clasa=1,exceptie_iec=('IEC 60228:2023 Tab.3 nota a: Al 10-35 mm2 doar circular; 35 SE pastrat — produs in fabricatie curenta' if (f=='SE' and s<=35) else None),
    sursa='Conductori Sector Clasa 1 Aluminiu') for (l,s,f,dn,dmin,dmax,fil,mn,mx) in SECTOR_AL]
out['constante_material']={'Cu':{'calitate':'ETP1','rho20_ohm_mm2_m':0.01707,'densitate_g_cm3':8.89,'alfa20':0.00393},
                           'Al':{'calitate':'H11','rho20_ohm_mm2_m':0.0275,'densitate_g_cm3':2.703,'alfa20':0.00403}}
json.dump(out,open('fise_tehnice_initiale.json','w'),ensure_ascii=False,indent=1)
print({k:len(v) for k,v in out.items() if isinstance(v,list)})
