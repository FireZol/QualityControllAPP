'use strict';
// Every user-visible string of the application (Romanian, correct diacritics: ș ț with comma below).
// Missing keys show ⟦key⟧ in production and throw when CTC_STRICT_I18N=1 (tests).

const S = {
  app: { name: 'ROMCAB CTC', long: 'ROMCAB CTC — Controlul calității tehnologice' },

  nav: {
    label: 'Navigare principală', home: 'Acasă', new_measurement: 'Măsurătoare nouă', register: 'Registru', batches: 'Loturi', analyses: 'Analize', specs: 'Fișe tehnice',
    lists: 'Nomenclatoare', users: 'Utilizatori', settings: 'Setări', audit: 'Jurnal', logout: 'Ieșire', password: 'Schimbă parola',
  },

  roles: { administrator: 'Administrator', inginer: 'Inginer', personal: 'Personal' },
  shift: { zi: 'Tura de zi', noapte: 'Tura de noapte' },
  material: { Cu: 'Cupru', Al: 'Aluminiu' },

  common: {
    save: 'Salvează', cancel: 'Renunță', add: 'Adaugă', edit: 'Editează', yes: 'da', no: 'nu', active: 'activ', inactive: 'inactiv',
    deactivate: 'Dezactivează', activate: 'Activează', search: 'Caută', filter: 'Filtrează', reset: 'Resetează', back: 'Înapoi',
    details: 'Detalii', actions: 'Acțiuni', name: 'Nume', date: 'Data', none: '—', total: 'Total', previous: 'Anterior', next: 'Următor',
    pages: 'Paginare', page_of: 'Pagina {page} din {pages}', required: 'obligatoriu', all: 'Toate', continue: 'Continuă', close: 'Închide',
    status: 'Stare', open: 'Deschide', from: 'De la', to: 'Până la', user: 'Utilizator', time: 'Ora', notes: 'Observații',
  },

  cfg: {
    families: 'Familii de produs', families_desc: 'Ce se măsoară pe familie: masă, rezistență măsurată (Cu / Al), rezistență teoretică', targets: 'Ținte și praguri', targets_desc: 'Temperatură, lungimi implicite ale probelor, Cpk, mărimea minimă a eșantionului',
    tests: 'Tipuri de încercări (cablu finit)', tests_desc: 'Catalogul încercărilor: rutină, pe probă, de tip; pe compuși; interne sau externe',
    tests_intro: 'Catalogul încercărilor pentru cablul finit (IEC 60502-1, HD 603, VDE 0276-603). Limitele se stabilesc pe fișa tehnică a fiecărui tip de cablu; aici se definește ce încercări există, în ce unități, dacă se aplică doar anumitor compuși (PVC, XLPE, HFFR …) și dacă se fac în laborator sau extern. Încercările pot fi dezactivate sau adăugate oricând.',
    tests_note: 'Codul nu se mai schimbă după creare (rezultatele salvate îl folosesc). Tipul (valoare, citiri multiple, conform/neconform, rezistență) se alege la creare. „Citiri multiple” dă media, minimul și maximul citirilor.',
    test_code: 'Cod', test_code_hint: 'litere mici, cifre, _', test_kind: 'Tip', test_unit: 'U.M.', test_decimals: 'Zecimale', test_scope: 'Categorie', test_applies: 'Se aplică la compuși', test_ref: 'Referință standard', test_inhouse: 'În laborator', test_sort: 'Ordine',
    kinds: { numeric: 'valoare', readings: 'citiri multiple', passfail: 'conform / neconform', resistance: 'rezistență (corectată la 20 °C)' },
    iec: 'Tabel IEC 60228', iec_desc: 'Valorile limită de referință: R max, număr minim de fire, Ø maxim fir',
    families_intro: 'Aici se stabilește ce se măsoară pentru fiecare familie și dacă familia este activă pentru măsurători. Se aplică măsurătorilor noi; înregistrările existente nu se modifică. Fiecare modificare se înregistrează în jurnal.',
    families_rule: 'Rezistența: mai mic este mai bine. Până la limită (R max din fișă sau, dacă lipsește, din IEC 60228) rezultatul este verde, peste limită roșu — indiferent dacă valoarea este măsurată, calculată teoretic din masă sau un toron raportat la liță.',
    families_nothing: 'O familie activă trebuie să măsoare cel puțin ceva (masă, rezistență sau diametru).',
    f_active: 'Activă pentru măsurători', f_mass: 'Masă', f_theor: 'R teoretică din masă', f_r_cu: 'R măsurată la Cu', f_r_al: 'R măsurată la Al',
    targets_intro: 'Valorile care înainte erau fixe în aplicație. Se aplică imediat măsurătorilor și analizelor noi.', range: 'Între {min} și {max}',
    t_group_entry: 'Introducerea măsurătorilor', t_group_analysis: 'Analize', t_group_checks: 'Verificări la revizii', t_group_spc: 'Cărți de control (SPC)',
    t: { sample_mm: 'Lungimea implicită a probei de masă', r_sample_m: 'Lungimea implicită a probei de rezistență', temp_min: 'Temperatura minimă admisă', temp_max: 'Temperatura maximă admisă',
      spc_min_n: 'Număr minim de valori pentru semnale SPC', spc_window: 'Fereastra de valori analizate (ultimele N)', spc_recent: 'Ultimele N valori care declanșează o alertă',
      cpk_good: 'Cpk bun (verde) de la', cpk_min: 'Cpk acceptabil (galben) de la', min_n: 'Număr minim de valori pentru Cp / Cpk', mass_ratio_min: 'Raport minim masă fișă / (fire × masa firului)', mass_ratio_max: 'Raport maxim masă fișă / (fire × masa firului)' },
    rule_title: 'Regula rezistenței', rule_text: 'La rezistență valoarea mai mică este mai bună; nu există limită inferioară.', rule_green: 'la limită sau sub ea: în limite (cu cât mai mică, cu atât mai bine).', rule_red: 'peste limită: neconform.',
    rule_where: 'Limita este R max din fișa tehnică (câmpul „R max la 20 °C” al construcției), iar dacă acesta lipsește valoarea din tabelul IEC 60228 de mai jos.',
    iec_licence: 'Se păstrează doar valorile limită numerice; textul standardului nu se stochează (licență ASRO). Modificările se înregistrează în jurnal și se aplică măsurătorilor și verificărilor noi.',
    iec_table: 'Tabel', iec_rmax: 'R max [Ω/km]', iec_w_circ: 'Fire min. circular', iec_w_comp: 'Fire min. compactat', iec_w_shaped: 'Fire min. profilat', iec_dmax: 'Ø max fir [mm]',
  },

  an: {
    title: 'Analize', export: 'Export', group_by: 'Grupează după', group_default: '— implicit —', showing: 'Se afișează ultimele {n} din {total}.',
    tabs: { control: 'Carte de control (SPC)', tendinta: 'Tendință', distributie: 'Distribuție și capabilitate', neconformitate: 'Rată de neconformitate', consum: 'Consum suplimentar', comparatie: 'Comparație' },
    tab_help: {
      control: 'Carte de control pentru valori individuale (I-MR): limitele de control vin din proces, nu din specificație; regulile Western Electric / Nelson semnalează derivele înainte de ieșirea din toleranță.',
      tendinta: 'Valorile măsurate în timp, cu banda min–max a limitelor față de care a fost judecată fiecare valoare.',
      distributie: 'Histogramă, medie, abatere standard, Cp și Cpk pe produs, utilaj și celelalte grupări.',
      neconformitate: 'Procentul rezultatelor în afara limitelor, cu sub minim și peste maxim separat.',
      consum: 'Abaterea masei peste maxim, în g/m și %; în kg doar dacă s-a introdus lungimea produsă.',
      comparatie: 'Aceeași mărime, alăturat, pentru utilaje, ture, schimburi, operatori sau clienți, în aceeași perioadă.',
    },
    groups: { product: 'Produs', machine: 'Utilaj', shift: 'Tura', crew: 'Schimb', operator: 'Operator', client: 'Client' },
    rule: 'Semnal', rules: { 1: 'un punct în afara limitelor de control (±3σ)', 2: '2 din 3 puncte consecutive dincolo de 2σ, de aceeași parte', 3: '4 din 5 puncte consecutive dincolo de 1σ, de aceeași parte', 4: '8 puncte consecutive de aceeași parte a liniei centrale', 5: '6 puncte consecutive crescătoare sau descrescătoare' },
    signals: 'Semnale', mr_chart: 'Amplitudinea mobilă (MR)', base_n: 'Limitele din primele N valori', base_hint: 'Gol = toate valorile; folosiți o perioadă stabilă ca referință.', spc_too_few: 'Sunt necesare cel puțin 3 valori.',
    spc_small: 'Sub {n} valori limitele de control sunt orientative.', spc_hint: 'Limitele de control (CL ± 3σ, σ = MR̄ / 1,128) descriu procesul, nu cerința din fișă; liniile punctate galbene sunt limitele fișei. Punctele marcate poartă numărul regulii încălcate.',
    need_product: 'Alegeți un produs (și, dacă este cazul, mărimea) pentru această analiză.', need_level: 'Produsul are măsurători pe mai multe niveluri; alegeți nivelul (suviță, toron sau liță).',
    no_data: 'Nu există măsurători pentru filtrele alese.', limits_changed: 'Limitele s-au schimbat între revizii în perioada aleasă; fiecare punct este judecat față de limitele din momentul măsurării, iar Cp / Cpk folosesc limitele cele mai recente.',
    limits_changed_short: 'limite schimbate', small_n: 'n < {n}: orientativ', cpk_hint: 'Cp = (max − min) / 6s; Cpk = distanța dintre medie și limita cea mai apropiată / 3s. Abaterea standard este cea a eșantionului (n − 1). Rezultatele informative și cele fără limită nu au Cp / Cpk.',
    pick_product_for_histogram: 'Alegeți un produs pentru a vedea histograma.', summary: 'Rezumat', points: 'Valorile măsurate', mean: 'Media', sd: 'Abatere standard', lsl: 'Limita min', usl: 'Limita max',
    out_count: 'În afara limitelor', capability: 'Capabilitate', note: 'Observații', nonconf: 'Neconformitate', nonconf_chart: 'Rezultate în afara limitelor [%]', nonconf_hint: 'Se numără doar rezultatele cu verdict (în limite, sub minim, peste maxim); cele informative și nedeterminate nu intră.',
    evaluated: 'Rezultate evaluate', pct_out: '% în afara limitelor', pct_sub: '% sub minim', pct_peste: '% peste maxim',
    consum: 'Consum suplimentar', consum_chart_kg: 'Consum suplimentar de material [kg]', consum_chart_gm: 'Abatere medie a masei peste maxim [g/m]', consum_hint: 'Se ia în calcul masa peste maxim; kg = abatere [g/m] × lungime produsă [m] / 1000, doar pentru înregistrările cu lungime produsă.',
    mass_results: 'Rezultate de masă', over_count: 'Peste maxim', pct_over: '% peste maxim', avg_excess_gm: 'Abatere medie [g/m]', avg_excess_pct: 'Abatere medie [%]', max_excess_gm: 'Abatere maximă [g/m]', with_length: 'Cu lungime produsă', excess_kg: 'Consum suplimentar [kg]',
    compare_hint: 'Punctul este media, linia groasă media ± abaterea standard, linia subțire minimul și maximul; liniile verticale sunt limitele.',
  },

  export: {
    version: 'Versiune', current: 'Curentă', created_at: 'Data și ora', shift_date: 'Data turei', material: 'Material', out_of_limit: 'În afara limitelor', revision: 'Fișa tehnică',
    lim_min: 'Limita min', lim_max: 'Limita max', sheet_register: 'Registru', sheet_results: 'Rezultate', sheet_inputs: 'Valori introduse',
  },

  cable: {
    batch: 'Lot', batches: 'Loturi', batch_no: 'Număr lot', new_batch: 'Lot nou', order: 'Comandă', design: 'Tip de cablu', drum: 'Toba', drums: 'Tobe', length_m: 'Lungime [m]', standard: 'Standard',
    produced_length: 'Lungime produsă [m]', produced_on: 'Data producției', created: 'Creat', sheet: 'Fișa tehnică', search: 'Caută (lot sau comandă)', session: 'Tip încercare',
    st: { deschis: 'deschis', inchis: 'închis' }, tests_done: 'Încercări', certificates: 'Certificate', no_batches: 'Niciun lot.', no_drums: 'Nicio tobă adăugată încă.',
    no_designs: 'Nu există tipuri de cablu în fișa tehnică activă a cablului finit. Un inginer trebuie să adauge tipurile în Fișe tehnice → Cablu de joasă tensiune și să activeze revizia.',
    edit_batch: 'Modifică datele lotului', add_tests: 'Adaugă încercări', close: 'Închide lotul', close_confirm: 'Închideți lotul? După închidere nu se mai pot adăuga încercări sau tobe (un inginer îl poate redeschide).', reopen: 'Redeschide lotul',
    batch_level_tests: 'Încercări pe întreg lotul', coverage: 'Încercări cerute', none_required_batch: 'Fișa tehnică nu listează încercările cerute pentru acest tip de cablu; se verifică doar ce s-a introdus.',
    missing: 'Încercări cerute încă lipsă:', all_done: 'Toate încercările cerute sunt înregistrate.', out_count: '{n} rezultate în afara cerințelor.',
    preview_cert: 'Previzualizează certificatul', issue: 'Emite certificatul', issue_confirm: 'Emiteți certificatul? Conținutul se îngheață și primește un număr; o corectură ulterioară necesită un certificat nou.',
    issue_hint: 'Doar un inginer poate emite; conținutul emis nu se mai schimbă.', no_certificates: 'Niciun certificat emis.', no_results_yet: 'Nu există încă încercări pentru acest lot.',
    override_needed: 'Lotul are rezultate neconforme. Certificatul se poate emite doar cu un motiv, care se tipărește pe certificat.', override_reason: 'Motivul emiterii cu abateri', nonconforming: 'neconform',
    superseded_by: 'înlocuit de {no}', superseded_banner: 'Certificat înlocuit de {no}', certificate: 'Certificat', certificate_title: 'Certificat de încercări pe lot', cert_no: 'Nr. certificat', draft: 'ciornă',
    preview_banner: 'PREVIZUALIZARE — nu este un certificat emis', conclusion: 'Concluzie', conforming_text: 'Lotul este conform cu cerințele fișei tehnice și ale standardului indicat, pe baza încercărilor de mai sus.',
    nonconforming_text: 'Lotul NU este conform cu toate cerințele.', test: 'Încercarea', unit: 'U.M.', requirement: 'Cerință', result: 'Rezultat', whole_batch: 'întreg lotul', no_batch_type: '— încercări de tip pe un tip de cablu —',
    type_tests: 'Încercări de tip', type_report: 'Raport de încercări de tip', type_conforming: 'Toate încercările de tip înregistrate sunt conforme.', type_nonconforming: 'Există încercări de tip neconforme.', no_type_results: 'Nu există încă încercări de tip înregistrate pentru acest tip de cablu.',
    scopes: { routine: 'Încercări de rutină (pe tobă)', sample: 'Încercări pe probă (pe lot)', type: 'Încercări de tip' },
    external: 'extern', external_title: 'Încercare făcută de un laborator extern; rezultatul provine din raportul lui', external_note: 'Încercare efectuată de un laborator extern; rezultatul provine din raportul acestuia.',
    limit: 'cerință', pass: 'Conform', fail: 'Neconform', not_tested: '— neîncercat —', readings_placeholder: 'valori separate prin spațiu', other_tests: 'Alte încercări ({n}) fără cerință în fișă', none_required: 'Fișa nu cere încercări de acest fel; le găsiți la „Alte încercări”.',
    hidden_note: '{n} valori măsurate fără cerință în fișa tehnică nu sunt afișate; ele rămân în înregistrări.', pass_fail_req: 'conform / neconform', design_data: 'Date despre cablu', cores: 'Număr de conductoare', rated_voltage: 'Tensiune nominală (U0/U)', rated_voltage_hint: 'De exemplu 0,6/1 kV', conductor_class: 'Clasa conductorului (IEC 60228)',
    insulation: 'Izolație', sheath: 'Manta', armour: 'Armură / ecran', required_tests: 'Încercări cerute de fișă', required_tests_hint: 'Bifați încercările cerute pentru acest tip de cablu (de rutină, pe probă, de tip). Cele bifate apar în lista principală de la introducerea încercărilor și se verifică la acoperirea lotului; celelalte rămân la „Alte încercări”.',
    tests_count: '{req} cerute, {lim} cu limite', type_report_link: 'Raport de tip', cable_design: 'Conductor', cable_voltage: 'Tensiune', cable_compounds: 'Izolație / manta', cable_standard: 'Standard', cable_tests: 'Încercări', cable_report: 'Raport',
    remarks: 'Observații', nothing_to_test: 'Nu există loturi deschise și nici tipuri de cablu în fișa activă. Creați un lot sau activați fișa tehnică a cablului.', summary: '{n} rezultate, {out} neconforme', suffix: { unit: 'unitate', len: 'lungime probă', temp: 'temperatură' },
  },

  print: {
    cable_required: 'Cerută', cable_scope: 'Categorie', elaborated: 'Elaborat', page: 'Pag.', print: 'Tipărește', apply: 'Aplică', copy: 'Exemplar', code: 'Cod', code_unset: 'de stabilit', signature: 'Semnătura',
    hint: 'Tipărirea se face din browser, pe hârtie sau în PDF (pentru registre largi alegeți A3 sau orientarea peisaj).',
    not_in_force: 'Revizie {status} — nu este document în vigoare', red_note: 'Valorile scrise cu roșu s-au modificat față de revizia anterioară.',
    iec_notes: 'Excepții acceptate de la IEC 60228:', pitch_legend: 'Pe rotor: pas [mm] / tensionare. Tensionarea la recepție conform fișei.',
    g_cu: 'Cupru', g_al: 'Aluminiu', g_al_carrier: 'Aluminiu purtător', g_al_evn: 'Aluminiu EVN', g_cl5_small: 'Secțiuni 0,5 – 6 mm²', g_cl5_large: 'Secțiuni 10 – 400 mm²',
    wire_in_strand: 'Ø sârmă în liță [mm]', g_strander: 'Strander {config}', rotor_col: 'Rotor {rotor}: pas / tens.', g_re: 'Conductori rotunzi (RE)', g_se: 'Conductori sector (SE)',
    die_drawing: 'Filieră trefilare', no_filters: 'Fără filtre: toate înregistrările curente.', truncated: 'se tipăresc primele {n}; restrângeți filtrele',
    printed_by: 'Tipărit de {user}, {when}', open_print: 'Tipărește', register_print: 'Tipărește registrul',
  },

  verdict: { ok: 'În limite', sub: 'Sub minim', peste: 'Peste maxim', nedeterminat: 'Nedeterminat', info: 'Informativ', neconform: 'Neconform' },

  errors: {
    required: 'Câmp obligatoriu.', invalid: 'Valoare nevalidă.', too_long: 'Textul este prea lung.', duplicate: 'Există deja o intrare cu această valoare.',
    rotor_format: 'Format așteptat: numere separate prin +, de exemplu 1+6+12+18.', capacity: 'Utilajul nu are suficiente straturi pentru această construcție.',
    password_short: 'Parola trebuie să aibă cel puțin 8 caractere.', password_username: 'Parola nu poate fi identică cu numele de utilizator.',
    password_mismatch: 'Cele două parole nu coincid.', password_same: 'Parola nouă trebuie să difere de cea actuală.', password_wrong: 'Parola actuală nu este corectă.',
    no_tests: 'Introduceți cel puțin o încercare.', batch_closed: 'Lotul este închis.',
    own_account: 'Nu vă puteți dezactiva propriul cont.', last_admin: 'Trebuie să rămână cel puțin un administrator activ.',
    restore_mismatch: 'Numele scris nu coincide cu numele fișierului.',
  },

  flash: {
    saved: 'Modificările au fost salvate.', added: 'Intrarea a fost adăugată.', toggled: 'Starea a fost schimbată.', password_changed: 'Parola a fost schimbată.',
    measurement_saved: 'Măsurătoarea a fost salvată.',
    measurement_saved_temp: 'Măsurătoarea a fost salvată. Atenție: temperatura este în afara intervalului admis (Nomenclatoare → Ținte și praguri); corecția a fost calculată, dar verificați valoarea.',
    measurement_corrected: 'Corecția a fost salvată ca versiune nouă; versiunea anterioară rămâne în istoric.',
    rev_created: 'Revizia nouă (ciornă) a fost creată din cea activă.', rev_submitted: 'Revizia a fost trimisă la verificare.',
    rev_verified: 'Revizia a fost verificată și activată; revizia anterioară a fost arhivată.', rev_rejected: 'Revizia a fost respinsă și a revenit la ciornă.',
    header_saved: 'Antetul reviziei a fost salvat.', construction_saved: 'Construcția a fost salvată.', construction_toggled: 'Starea construcției a fost schimbată.',
    settings_saved_restart: 'Setările au fost salvate. Modificările de port, adresă sau nume public se aplică după repornirea serviciului.',
    backup_done: 'Backup-ul a fost creat.', restore_done: 'Baza de date a fost restaurată. Dacă sesiunea a expirat, autentificați-vă din nou.',
    batch_created: 'Lotul a fost creat. Adăugați tobele și încercările.', batch_closed: 'Lotul a fost închis.', batch_reopened: 'Lotul a fost redeschis.', cert_issued: 'Certificatul a fost emis.',
    e_batch_closed: 'Lotul este închis.', e_no_results: 'Nu există încercări pentru acest lot.',
    e_generic: 'Acțiunea nu a putut fi efectuată.', e_invalid: 'Datele introduse nu sunt valide.',
    e_open_revision_exists: 'Există deja o revizie în lucru pentru acest document.', e_no_active_revision: 'Documentul nu are o revizie activă din care să se pornească.',
    e_later_stage: 'Această familie de produse se activează într-o etapă următoare.',
    e_not_author: 'Doar elaboratorul poate modifica sau trimite această ciornă.', e_not_draft: 'Revizia nu mai este ciornă.',
    e_not_in_verification: 'Revizia nu este în verificare.', e_author_cannot_verify: 'Elaboratorul nu poate verifica propria revizie.',
    e_forbidden: 'Nu aveți dreptul să efectuați această acțiune.', e_reason_required: 'Motivul este obligatoriu.',
    e_iec_errors: 'Revizia nu respectă IEC 60228; vedeți verificările de mai jos.', e_edition_revision_taken: 'Combinația ediție + revizie există deja pentru acest document.',
    e_not_found: 'Elementul nu a fost găsit.',
    e_restore_bad_name: 'Numele fișierului de backup nu este valid.', e_restore_not_found: 'Fișierul de backup nu a fost găsit.',
    e_restore_invalid_backup: 'Fișierul ales nu este o bază de date validă.', e_restore_safety_failed: 'Nu s-a putut face copia de siguranță a bazei curente; restaurarea a fost oprită.',
  },

  error_pages: {
    home: 'Înapoi la pagina de start',
    not_found: { title: 'Pagina nu a fost găsită', text: 'Adresa nu există sau elementul căutat nu mai este disponibil.' },
    forbidden: { title: 'Acces interzis', text: 'Nu aveți dreptul să deschideți această pagină sau să efectuați această acțiune.' },
    csrf: { title: 'Cerere respinsă', text: 'Formularul a expirat sau nu provine din aplicație. Reîncărcați pagina și încercați din nou.' },
    server_error: { title: 'Eroare internă', text: 'A apărut o eroare neașteptată. Datele existente nu au fost afectate. Anunțați administratorul dacă problema persistă.' },
    maintenance: { title: 'Aplicația este în întreținere', text: 'Se efectuează o restaurare sau o actualizare. Încercați din nou în câteva secunde.' },
  },

  login: {
    title: 'Autentificare', username: 'Utilizator', password: 'Parolă', submit: 'Intră',
    failed: 'Utilizator sau parolă incorectă.',
    locked: 'Prea multe încercări eșuate. Contul este blocat temporar; reîncercați peste {minutes} min.',
  },

  password: {
    title: 'Schimbarea parolei', forced: 'Trebuie să schimbați parola înainte de a continua.', current: 'Parola actuală', new: 'Parola nouă',
    confirm: 'Confirmați parola nouă', hint: 'Cel puțin 8 caractere.', submit: 'Schimbă parola',
  },

  home: {
    title: 'Acasă', new_measurement: 'Măsurătoare nouă', current_shift: 'Tura curentă: {shift} · schimbul {crew}',
    today: 'Măsurătorile de azi (tura curentă prima)', today_empty: 'Nicio măsurătoare înregistrată azi.', start_first: 'Începeți prima măsurătoare »',
    spc: 'Semnale SPC (deriva procesului)', spc_hint: 'Produse la care ultimele valori încalcă o regulă de control, chiar dacă încă sunt în limite. Limitele de control se calculează din valorile anterioare.',
    out_of_limit: 'Rezultate în afara limitelor — ultimele 24 de ore', out_empty: 'Nicio valoare în afara limitelor în ultimele 24 de ore.', results: 'Valori',
  },

  quantity: {
    d: 'Ø', d1: 'Ø citirea 1', d2: 'Ø citirea 2', d_avg: 'Ø mediu', ovality: 'Ovalitate', h: 'Înălțime Î', l: 'Lățime L', mass_gm: 'Masă [g/m]',
    r_max_finished: 'R max al conductorului finit [Ω/km]', d_ech: 'Ø echivalent din masă', r20_theor: 'R20 teoretică [Ω/km]', r20: 'R20 măsurată [Ω/km]', r20_echiv: 'R20 toron raportată la liță [Ω/km]', r_max: 'R max la 20 °C [Ω/km]',
  },

  input: {
    d1: 'Ø citirea 1 [mm]', d2: 'Ø citirea 2, perpendicular [mm]', h: 'Înălțime Î [mm]', l: 'Lățime L [mm]', mass_g: 'Masa probei [g]',
    sample_mm: 'Lungimea probei [mm]', r_value: 'Rezistență măsurată', r_unit: 'Unitate', r_sample_m: 'Lungimea probei de rezistență [m]', temp_c: 'Temperatura [°C]',
  },

  tests: { parts: { avg: 'medie', min: 'minim', max: 'maxim' } },

  level: { suvita: 'Suviță', toron: 'Toron', lita: 'Liță' },

  measure: {
    level: 'Nivel măsurat', title: 'Măsurătoare nouă', family: 'Familie de produs', machine: 'Utilaj', construction: 'Produs (secțiune și formă)', choose: '— alegeți —',
    no_machines: 'Pentru această familie nu există niciun utilaj activ. Un Inginer sau Administrator trebuie să adauge unul în Nomenclatoare → Utilaje.',
    no_constructions: 'Nu există produse în fișa tehnică activă potrivite pentru acest utilaj. Cel mai des fișa nu are încă o revizie activă: un Inginer o verifică și un al doilea Inginer o activează. Vedeți:',
    active_revision: 'Fișa tehnică activă: Ed. {edition}, Rev. {revision} — {doc}',
    limits_caption: 'Limite din fișa tehnică activă', nominal: 'Nominal', limits: 'Limite', source: 'Sursă', source_sheet: 'fișa tehnică', informative_note: 'informativ, fără verdict',
    sample_data: 'Datele probei', operator: 'Operator', client: 'Client', sample_type: 'Tip de probă', none_selected: '— nespecificat —',
    length_no: 'Nr. lungime', length_no_hint: 'Se propune automat pentru probele numerotate.',
    values: 'Valori măsurate', sample_mm_hint: 'Implicit {n} mm.', r_optional: 'Opțional. Rezistența se măsoară la materialele activate pentru familie (Nomenclatoare → Familii de produs).', r_sample_hint: 'Implicit {n} m, 2 m la secțiuni mari.',
    produced_length: 'Lungime produsă [m]', optional: 'Opțional.', notes: 'Observații',
    live_title: 'Rezultat înainte de salvare', live_hint: 'Rezultatele apar aici pe măsură ce introduceți valorile. Valorile în afara limitelor se marchează, dar nu blochează salvarea.',
    wire_mass_hint: 'Masa firului: g/m este egal cu kg/km (unitatea din fișă).',
    save: 'Salvează măsurătoarea', cell_empty: 'Completați valorile pentru a vedea rezultatul.', temp_warning: 'Temperatura este în afara intervalului admis ({min} … {max} °C).',
  },

  register: {
    title: 'Registru măsurători', shift: 'Tura', crew: 'Schimb', product: 'Produs', only_out: 'Doar cu valori în afara limitelor', all_versions: 'Arată și versiunile vechi',
    count: '{total} înregistrări', no: 'Nr.', diameter: 'Ø / Î × L [mm]', versions: '{n} versiuni', versions_title: 'Înregistrarea are mai multe versiuni (corecturi)',
    empty: 'Nicio înregistrare pentru filtrele alese.', clear_filters: 'Ștergeți filtrele', add_first: 'Adăugați o măsurătoare',
  },

  detail: {
    title: 'Înregistrarea nr. {no}', quantity: 'Mărime', value: 'Valoare', limits: 'Limite', verdict: 'Verdict', deviation: 'Abatere față de R max', source: 'Sursa limitei',
    calculated: 'calculat', sheet_revision: 'Fișa tehnică folosită', ed_rev: 'Ed. {edition}, Rev. {revision}',
    correct: 'Corectează', denied_not_own: 'Personalul poate corecta doar înregistrările proprii.', denied_other_shift: 'Personalul poate corecta doar în aceeași tură.',
    denied_not_found: '', new_same: 'Măsurătoare nouă, același produs', versions: 'Versiuni și istoric', version_n: 'Versiunea {n}', current: 'curentă', superseded: 'înlocuită',
    saved_by: 'Salvată de', reason: 'motiv', correction_reason: 'Motivul corecturii', correction_reason_label: 'De ce se corectează înregistrarea?',
    save_correction: 'Salvează corecția (versiune nouă)', correct_title: 'Corectarea înregistrării nr. {no}',
    correct_hint: 'Se creează versiunea {version}. Versiunea anterioară rămâne în istoric. Înregistrarea păstrează fișa tehnică, tura și schimbul inițiale.',
  },

  status: { ciorna: 'ciornă', in_verificare: 'în verificare', activa: 'activă', arhivata: 'arhivată' },

  specs: {
    title: 'Fișe tehnice', document: 'Document', code: 'Cod', code_unset: 'de stabilit', active_revision: 'Revizia activă', open_revision: 'În lucru',
    later_stage: 'etapa următoare', revisions: 'Revizii', none_active: 'nicio revizie activă', ed_rev: 'Ed. {edition}, Rev. {revision}',
    later_stage_notice: 'Măsurătorile și fluxul de revizii pentru această familie se activează într-o etapă următoare; datele inițiale sunt încărcate doar pentru consultare.',
    new_revision: 'Revizie nouă', new_revision_hint: 'Se pornește din revizia activă.', blocked_open: 'Există deja o revizie în lucru.', blocked_no_active: 'Nu există o revizie activă; verificați și activați mai întâi ciorna existentă.',
    edition: 'Ediție', revision: 'Revizie', elaborated: 'Elaborat', verified: 'Verificat', activated: 'Activată', change_note: 'Modificări', rejected: 'Respinsă',
    workflow: 'Flux de verificare', submit: 'Trimite la verificare', submit_hint: 'Un alt inginer trebuie să verifice și să activeze revizia.',
    verify: 'Verifică și activează', verify_confirm: 'Verificați și activați această revizie? Revizia activă curentă va fi arhivată.',
    waiting_verification: 'În așteptarea verificării.', reject: 'Respinge', reject_reason: 'Motivul respingerii', author_cannot_verify: 'Elaboratorul nu poate verifica propria revizie; așteptați verificarea unui alt inginer.',
    data_quality: 'Valori de verificat față de documentul original', data_quality_hint: 'Aceste valori au părut inconsistente la transcrierea din documentele scanate. Nu au fost corectate automat: confirmați-le pe hârtie.',
    iec_checks: 'Verificări IEC 60228', checks_ok: 'Toate verificările au trecut.', blocking: 'Blochează:', warning: 'Avertizare:',
    header_edit: 'Antetul reviziei', code_hint: 'Codul documentului (definit în aplicație).', constructions: 'Construcții',
    changed_legend: 'valoare modificată', changed_hint: 'față de revizia anterioară (roșu, ca în documentele actuale).', add_construction: 'Adaugă construcție',
    no_constructions: 'Nicio construcție.', removed_rows: 'Construcții eliminate față de revizia anterioară: {n}', new_row: 'nou',
    red_paper: 'roșu pe original', red_paper_title: 'Valoare tipărită cu roșu în documentul original (ultima modificare)',
    yellow_paper: 'galben pe original', yellow_paper_title: 'Valoare marcată cu galben în documentul original',
    iec_exception: 'excepție IEC', coated: 'cositorit', edit_construction: 'Editare: {label}', identity: 'Identificare', material: 'Material', section: 'Secțiune [mm²]',
    shape: 'Formă', destination: 'Destinație', coated_label: 'Cositorit', printed_label: 'Denumire (ca în fișă)', printed_label_hint: 'Dacă rămâne gol se generează din secțiune și formă.',
    wires: 'Număr de fire', wire_d: 'Ø fir [mm]', die: 'Filieră', die_hint: 'Text liber, de exemplu 3.21 / 3.215.',
    iec_exception_reason: 'Motivul excepției de la IEC 60228', iec_exception_hint: 'Dacă este completat, abaterile de la IEC devin avertizări și motivul se tipărește pe fișă.',
    r20_hint: 'R max la 20 °C: ținta rezistenței conductorului finit. Dacă rămâne gol se folosește valoarea din IEC 60228. Mai mic este mai bine: până la limită verde, peste limită roșu — indiferent cum s-a obținut valoarea (măsurată, teoretică din masă sau toron raportat la liță).',
    limits: 'Limite', tolerance: 'Toleranță ±', limits_hint: 'Dacă se completează nominalul și toleranța, iar min / max rămân goale, acestea se calculează. Rândurile goale rămân „nedeterminat”.',
    process_params: 'Parametri de cablare', strander: 'Strander', rotor: 'Rotor', pitch: 'Pas [mm]', tension: 'Tensionare',
    params_hint: 'Pe rotor: 6, 12, 18, 24 sau „receptie” pentru tensionarea la recepție. Rândurile goale se ignoră.',
  },

  sheet: {
    construction: 'Construcție', wires_x_d: 'Fire × Ø fir [mm]', rope_d: 'Ø funie / Î × L [mm]', mass: 'Masă [g/m]', stranding: 'Cablare: pas / tensionare pe rotor',
    reception: 'Tensionare recepție', die: 'Filieră', d_nominal: 'Ø nominal [mm]', d_range: 'Ø min … max [mm]', h_l: 'Î × L [mm]', destination: 'Destinație', wires: 'Nr. fire',
    cable_design: 'Conductor', cable_voltage: 'Tensiune', cable_compounds: 'Izolație / manta', cable_standard: 'Standard', cable_tests: 'Încercări', cable_report: 'Raport',
    r_max: 'R max [Ω/km]', mass_kgkm: 'Masă [kg/km]', wires_lita: 'Fire în liță', strands: 'Toroane × fire', wire_d5: 'Ø sârmă [mm]', suvita: 'Masă suviță [g/m]', toron: 'Masă toron [g/m]', lita: 'Masă liță [g/m]',
  },

  limitq: {
    r20: 'R max la 20 °C', funie_r20: 'R max la 20 °C', conductor_r20: 'R max la 20 °C', sarma_r20: 'R max la 20 °C', lita_r20: 'R max la 20 °C (conductor finit)',
    d: 'Ø', h: 'Înălțime Î', l: 'Lățime L', mass: 'Masă', suvita_mass: 'Masă suviță', toron_mass: 'Masă toron', lita_mass: 'Masă liță (aprox.)', sarma_d: 'Ø sârmă', sarma_mass: 'Masă sârmă',
  },

  iec: {
    wires_below_min: 'nr. de fire {wires} este sub minimul IEC 60228 Tab. 4 ({min}) pentru forma {shape}.',
    wires_below_min_exception: 'nr. de fire {wires} este sub minimul IEC 60228 Tab. 4 ({min}) pentru forma {shape} — excepție acceptată: {reason}',
    wires_missing: 'numărul de fire lipsește (IEC 60228 Tab. 4 cere minimum {min}).',
    wires_missing_exception: 'numărul de fire lipsește — excepție acceptată: {reason}',
    class1_al_circular_only: 'IEC 60228 Tab. 3 nota a: aluminiu 10–35 mm² doar circular, iar {section} mm² este sector.',
    class1_al_circular_only_exception: 'IEC 60228 Tab. 3 nota a: aluminiu 10–35 mm² doar circular — excepție acceptată: {reason}',
    wire_d_over_max: 'Ø firului {d} mm depășește maximul IEC 60228 Tab. 5 ({max} mm).',
    wire_d_over_max_exception: 'Ø firului {d} mm depășește maximul IEC 60228 Tab. 5 ({max} mm) — excepție acceptată: {reason}',
    limits_order: 'limitele pentru „{quantity}” nu sunt coerente (min trebuie să fie mai mic decât max).',
    no_constructions: 'revizia nu conține nicio construcție activă.',
    iec_no_row: 'secțiunea {section} mm² nu există în tabelul IEC 60228 folosit pentru verificare.',
    mass_vs_wires: 'masa nu corespunde cu nr. de fire × masa firului (raport {ratio}); verificați.',
  },

  stats: {
    title: 'Statistici măsurători', heading: 'Statistici pentru {label}', hint: 'Media, minimul, maximul și abaterea standard ale măsurătorilor curente, ca bază pentru stabilirea limitelor într-o revizie următoare.',
    mean: 'Media', sd: 'Abatere standard', empty: 'Nu există încă măsurători pentru această construcție.', link: 'Statistici',
  },

  lists: {
    title: 'Nomenclatoare', intro: 'Listele se pot completa, redenumi și dezactiva. O intrare folosită în măsurători nu se șterge, doar se dezactivează.',
    names: {
      machine_types: 'Tipuri de utilaj', machines: 'Utilaje', operators: 'Operatori', clients: 'Clienți', sample_types: 'Tipuri de probă', crews: 'Schimburi',
      shapes: 'Forme', destinations: 'Destinații', materials: 'Constante material', compounds: 'Compuși (izolație / manta)', cable_standards: 'Standarde cablu',
    },
    descriptions: {
      machine_types: 'Procesul și familiile de produs permise', machines: 'Nume, tip și configurația rotoarelor', operators: 'Nume și prenume', clients: 'Nume scurt',
      sample_types: 'Lista tipurilor de probă', crews: 'Schimburile A / B / C și data de start a ciclului', shapes: 'RE, RM, RMC, SM …', destinations: 'Unifilar, Multifilar, Armate …',
      materials: 'Rezistivitate, densitate, coeficient de temperatură', compounds: 'PVC, XLPE, HFFR … folosiți la fișele cablurilor', cable_standards: 'IEC 60502-1, HD 603, VDE 0276-603 …',
    },
    fields: {
      name: 'Nume', machine_type_id: 'Tip utilaj', rotor_config: 'Configurație rotoare', full_name: 'Nume și prenume', short_name: 'Nume scurt', numbered: 'Numerotată', sort: 'Ordine',
      cycle_start: 'Prima zi de tură de zi a ciclului', code: 'Cod', kind: 'Tip', iec_group: 'Grup IEC', material: 'Material', grade: 'Calitate', rho20: 'ρ20 [Ω·mm²/m]',
      compounds_code: 'Cod', compounds_name: 'Denumire', density: 'Densitate δ [g/cm³]', alpha20: 'α20 [1/K]', clients_name: 'Denumire completă', crews_name: 'Schimb',
    },
    families: 'Familii de produs permise', crews_hint: 'Fiecare schimb are un ciclu de 12 zile: 4 zile de zi, 2 libere, 4 nopți, 2 libere. Introduceți prima zi de tură de zi a fiecărui schimb; schimburile A, B, C pornesc la 4 zile distanță.',
    machines_hint: 'Configurația rotoarelor (de exemplu 1+6+12+18) limitează construcțiile la cele cu suficiente fire; dacă rămâne goală nu se aplică nicio limită de capacitate.',
    materials_hint: 'Modificările se înregistrează în jurnal și se aplică măsurătorilor noi. Toate valorile de referință (R max, ρ20) sunt la 20 °C, ca în standard.',
    kt_title: 'Corecția de temperatură (IEC 60228, Anexa B)', kt_rule: 'Punctul de referință este 20 °C: o rezistență măsurată la temperatura t se aduce la 20 °C cu R20 = Rt × kt, kt = 1 / (1 + α20 · (t − 20)), cu α20 al materialului. Rezistența teoretică din masă se calculează direct la 20 °C (R20 = ρ20 / A). Celelalte mărimi derivate folosesc formulele din standard.',
    kt_a1: 'kt din Tab. A.1 (α = 0,004)', kt_ref: 'referință', kt_match: 'Verificare: formula aplicației cu α = 0,004 reproduce toate cele 41 de valori din Tab. A.1 (diferență maximă {diff}).', kt_mismatch: 'Atenție: formula nu reproduce Tab. A.1 (diferență maximă {diff}).', materials_check: 'Verificare: corecția de temperatură la 27 °C pentru cupru este {kt}.',
  },

  users: {
    title: 'Utilizatori', new: 'Utilizator nou', edit: 'Editare: {name}', username: 'Utilizator', username_hint: 'Litere, cifre, punct, cratimă sau liniuță de subliniere (3–40).',
    full_name: 'Nume complet', role: 'Rol', job_title: 'Funcție', job_title_hint: 'De exemplu CTC, Manager proces.', active_label: 'Cont activ', must_change: 'parolă de schimbat',
    self_note: 'Este contul dumneavoastră: nu îl puteți dezactiva.', reset_title: 'Resetare parolă', reset_hint: 'Se generează o parolă unică, afișată o singură dată; utilizatorul trebuie să o schimbe la prima autentificare.',
    reset: 'Resetează parola', reset_confirm: 'Resetați parola acestui utilizator? Sesiunile lui active vor fi închise.',
    one_time_title: 'Parolă unică', one_time_for: 'Parola unică pentru {name} ({username}):', one_time_hint: 'Se afișează o singură dată. Comunicați-o utilizatorului; la prima autentificare i se va cere să o schimbe.',
  },

  settings: {
    title: 'Setări', modules: 'Module', modules_hint: 'Aplicația de bază este măsurarea CTC pentru conductoare. Părțile de mai jos sunt oprite până le porniți; datele existente nu se pierd.', mod_cable: 'Cablu finit: încercări, loturi și certificate', mod_analytics: 'Analize: tendințe, capabilitate, diagrame de control și alerte pe pagina principală', server: 'Server', restart_notice: 'Portul, adresa de rețea și numele public se aplică după repornirea serviciului.', port: 'Port', bind: 'Adresa de rețea',
    bind_hint: '0.0.0.0 = toate interfețele; 127.0.0.1 = doar acest calculator.', public_name: 'Nume public', public_name_hint: 'De exemplu ctc.romcab.local (înregistrat de IT în DNS).',
    sessions: 'Sesiuni', idle_hours: 'Expirare după inactivitate [ore]', shifts: 'Ture', day_start: 'Începutul turei de zi', night_start: 'Începutul turei de noapte',
    backup: 'Backup', backup_dir: 'Folder de backup', backup_dir_hint: 'Local sau de rețea (\\\\server\\backup\\ctc). Gol = folderul implicit.', backup_time: 'Ora backup-ului zilnic',
    backup_keep: 'Număr de copii păstrate', backup_auto: 'Backup automat zilnic', backups: 'Copii de siguranță', backup_folder: 'Folder curent: {dir}', backup_now: 'Backup acum',
    backup_failed: 'Backup-ul a eșuat', file: 'Fișier', size: 'Mărime', restore: 'Restaurează', no_backups: 'Nu există încă niciun backup.',
    restore_title: 'Restaurarea bazei de date', restore_warning: 'Toate datele curente vor fi înlocuite cu cele din backup. Înainte de restaurare se face automat o copie de siguranță a bazei curente.',
    restore_file: 'Fișier ales', restore_type: 'Pentru confirmare, scrieți numele fișierului', restore_type_hint: 'Copiați numele afișat mai sus.', restore_do: 'Restaurează',
  },

  audit: {
    title: 'Jurnal de audit', action: 'Acțiune', entity: 'Obiect', details: 'Detalii',
    actions: {
      login: 'autentificare', login_failed: 'autentificare eșuată', login_blocked: 'autentificare blocată', logout: 'ieșire', password_change: 'schimbare parolă', password_reset: 'resetare parolă',
      user_create: 'utilizator creat', user_edit: 'utilizator modificat', measurement_add: 'măsurătoare adăugată', measurement_correct: 'măsurătoare corectată',
      revision_new: 'revizie nouă', revision_header: 'antet revizie', revision_submit: 'revizie trimisă', revision_verify: 'revizie verificată', revision_reject: 'revizie respinsă',
      construction_add: 'construcție adăugată', construction_edit: 'construcție modificată', construction_deactivate: 'construcție dezactivată', construction_activate: 'construcție activată',
      setting_change: 'setare modificată', backup: 'backup', backup_failed: 'backup eșuat', restore: 'restaurare', material_change: 'constantă material',
      targets_change: 'ținte modificate', family_change: 'familie modificată', iec_add: 'IEC: valoare adăugată', iec_change: 'IEC: valoare modificată',
      list_add: 'listă: adăugare', list_edit: 'listă: modificare', list_toggle: 'listă: stare', forbidden: 'acces refuzat', seed: 'inițializare',
    },
  },
};

// ---- accessor ----
const STRICT = process.env.CTC_STRICT_I18N === '1';

function wrap(obj, path) {
  return new Proxy(obj, {
    get(target, key) {
      if (typeof key === 'symbol') return target[key];
      if (!Object.prototype.hasOwnProperty.call(target, key)) {
        if (key === 'toJSON' || key === 'then') return undefined;
        if (STRICT) throw new Error(`missing i18n key ${path}${String(key)}`);
        return `⟦${path}${String(key)}⟧`;
      }
      const v = target[key];
      return v && typeof v === 'object' && !Array.isArray(v) ? wrap(v, `${path}${key}.`) : v;
    },
  });
}

/** Fill {placeholders} in a string. */
function f(str, params) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined && params[k] !== null ? String(params[k]) : ''));
}

const T = wrap(S, '');

/** Safe lookup for keys built at run time: S[section][key] or the fallback (never throws). */
function opt(section, key, fallback) {
  return S[section] && Object.prototype.hasOwnProperty.call(S[section], key) ? S[section][key] : fallback;
}

module.exports = { T, f, S, opt };
