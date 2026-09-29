'use strict';
// Dev tool: builds a finished-cable batch through the real routes and screenshots the entry form, the batch page and the certificate.
//   node tools/cable-walkthrough.js <screenshot-dir>
const path=require('path'),{execSync}=require('child_process');
const pw=require(path.join(execSync('npm root -g').toString().trim(),'playwright'));
const { startApp, adminClient, makeUser } = require('../app/test/helpers');
(async()=>{
 const app=await startApp(); const admin=await adminClient(app);
 const a=await makeUser(app,admin,'ing.a','inginer','Ana Inginer'), b=await makeUser(app,admin,'ing.b','inginer','Bogdan Inginer'), c=await makeUser(app,admin,'ctc1','personal','Cătălin CTC');
 const db=app.db; const doc=db.get("SELECT id FROM spec_documents WHERE doc_type='CABLU_LV'").id, rv=db.get('SELECT id FROM spec_revisions WHERE document_id=?',doc).id;
 const base=`/fise/${doc}/revizii/${rv}`;
 await a.postForm(base+'/constructii/noua',base+'/constructii/noua',{material_id:String(db.get("SELECT id FROM materials WHERE code='Cu'").id),section:'16',shape_id:String(db.get("SELECT id FROM shapes WHERE code='RM'").id),label:'NYY-J 4x16 0,6/1 kV',cab_cores:'4',cab_voltage:'0,6/1 kV',cab_class:'2',cab_insulation:'PVC',cab_sheath:'PVC',cab_standard:'IEC 60502-1',lim_cablu_ins_thick_avg_min:'1,0',lim_cablu_ins_thick_min_min:'0,8',lim_cablu_sheath_thick_avg_min:'1,4',lim_cablu_od_avg_min:'20',lim_cablu_od_avg_max:'22',cab_tests:['cond_res','hv_test','ins_thick','sheath_thick','od','marking','pvc_heat_shock','ir_20']});
 await a.postForm(base,base+'/trimite',{}); await b.postForm(base,base+'/verifica',{});
 const design=db.get('SELECT id FROM constructions WHERE revision_id=?',rv).id;
 let r=await c.postForm('/loturi/nou','/loturi/nou',{batch_no:'L-2026-0456',order_no:'CMD-1188',client_id:String(db.get("SELECT id FROM clients WHERE short_name='SBT'").id),construction_id:String(design),standard:'IEC 60502-1',produced_length_m:'3000',produced_on:'2026-09-28'});
 const bid=/\/loturi\/(\d+)/.exec(r.location)[1];
 for(const n of ['1','2','3']) await c.postForm('/loturi/'+bid,'/loturi/'+bid+'/tobe',{drum_no:n,length_m:'1000'});
 const fam=db.get("SELECT id FROM product_families WHERE code='CABLE_LV'").id, mach=db.get("SELECT id FROM machines WHERE name LIKE 'STA%'").id, st=db.get("SELECT id FROM sample_types WHERE name='Încercare de rutină'").id;
 const dr=db.all('SELECT id FROM drums ORDER BY id').map(x=>x.id);
 await c.postForm('/masuratori/nou','/masuratori/nou',{family_id:fam,machine_id:mach,batch_id:bid,drum_id:dr[0],construction_id:design,sample_type_id:st,t_cond_res:'1,10',t_cond_res_unit:'ohm_km',t_cond_res_temp:'22',t_ins_thick:'1,05 1,10 0,95 1,00 1,02',t_marking:'pass',t_hv_test:'pass',t_sheath_thick:'1,6 1,5 1,45',t_od:'21,0 21,2 20,9'});
 await c.postForm('/masuratori/nou','/masuratori/nou',{family_id:fam,machine_id:mach,batch_id:bid,drum_id:dr[1],construction_id:design,sample_type_id:st,t_cond_res:'1,20',t_cond_res_unit:'ohm_km',t_cond_res_temp:'20',t_ins_thick:'0,9 0,95 0,92',t_marking:'pass',t_hv_test:'fail'});
 const b1=await pw.chromium.launch(); const p=await (await b1.newContext({viewport:{width:1300,height:900}})).newPage();
 await p.goto(app.base+'/login'); await p.fill('input[name=username]','ing.a'); await p.fill('input[name=password]',a.password); await p.click('main button[type=submit]');
 const out='(process.argv[2] || '/tmp') + '/'';
 await p.goto(`${app.base}/masuratori/nou?family=${fam}&batch=${bid}&drum=${dr[2]}&machine=${mach}`); 
 await p.fill('input[name=t_cond_res]','1,08'); await p.fill('input[name=t_cond_res_temp]','20'); await p.fill('input[name=t_ins_thick]','1,0 1,05 1,1'); await p.selectOption('select[name=t_hv_test]','pass');
 await p.screenshot({path:out+'cab-entry.png',fullPage:true});
 await p.goto(`${app.base}/loturi/${bid}`); await p.screenshot({path:out+'cab-batch.png',fullPage:true});
 await p.goto(`${app.base}/loturi/${bid}/certificat`); await p.waitForSelector('.pg-wrap'); await p.screenshot({path:out+'cab-cert.png'});
 await b1.close(); await app.cleanup();
})().catch(e=>{console.error(e);process.exit(1)});
