'use strict';
// English texts, part C (data sheets, master data, users, settings, audit log).

module.exports = {
  specs: {
    title: 'Data sheets', document: 'Document', code: 'Code', code_unset: 'to be set', active_revision: 'Active revision', open_revision: 'In progress',
    later_stage: 'later stage', revisions: 'Revisions', none_active: 'no active revision', ed_rev: 'Ed. {edition}, Rev. {revision}',
    later_stage_notice: 'Measurements and the revision workflow for this family are activated in a later stage; the initial data is loaded for reference only.',
    new_revision: 'New revision', new_revision_hint: 'It starts from the active revision.', blocked_open: 'A revision is already in progress.', blocked_no_active: 'There is no active revision; first verify and activate the existing draft.',
    edition: 'Edition', revision: 'Revision', elaborated: 'Drawn up', verified: 'Verified', activated: 'Activated', change_note: 'Changes', rejected: 'Rejected',
    workflow: 'Verification workflow', submit: 'Submit for verification', submit_hint: 'Another engineer has to verify and activate the revision.',
    verify: 'Verify and activate', verify_confirm: 'Verify and activate this revision? The current active revision will be archived.',
    waiting_verification: 'Waiting for verification.', reject: 'Reject', reject_reason: 'Reason for rejection', author_cannot_verify: 'The author cannot verify their own revision; wait for another engineer to verify it.',
    data_quality: 'Values to check against the original document', data_quality_hint: 'These values looked inconsistent when transcribed from the scanned documents. They were not corrected automatically: confirm them on paper.',
    iec_checks: 'IEC 60228 checks', checks_ok: 'All checks passed.', blocking: 'Blocks:', warning: 'Warning:',
    header_edit: 'Revision header', code_hint: 'The document code (defined in the application).', constructions: 'Constructions',
    changed_legend: 'changed value', changed_hint: 'compared with the previous revision (red, as in the current documents).', add_construction: 'Add construction',
    no_constructions: 'No construction.', removed_rows: 'Constructions removed compared with the previous revision: {n}', new_row: 'new',
    red_paper: 'red on the original', red_paper_title: 'Value printed in red in the original document (last change)',
    yellow_paper: 'yellow on the original', yellow_paper_title: 'Value marked yellow in the original document',
    iec_exception: 'IEC exception', coated: 'tinned', edit_construction: 'Edit: {label}', identity: 'Identification', material: 'Material', section: 'Section [mm²]',
    shape: 'Shape', destination: 'Destination', coated_label: 'Tinned', printed_label: 'Name (as on the sheet)', printed_label_hint: 'If left empty it is generated from the section and shape.',
    wires: 'Number of wires', wire_d: 'Wire Ø [mm]', die: 'Die', die_hint: 'Free text, for example 3.21 / 3.215.',
    iec_exception_reason: 'Reason for the exception from IEC 60228', iec_exception_hint: 'If filled in, deviations from IEC become warnings and the reason is printed on the sheet.',
    r20_hint: 'R max at 20 °C: the resistance target of the finished conductor. If left empty, the value from IEC 60228 is used. Lower is better: green up to the limit, red above it — however the value was obtained (measured, theoretical from mass, or strand reported to the conductor).',
    limits: 'Limits', tolerance: 'Tolerance ±', limits_hint: 'If the nominal and the tolerance are filled in and min / max are left empty, they are calculated. Empty rows stay “undetermined”.',
    process_params: 'Stranding parameters', strander: 'Strander', rotor: 'Rotor', pitch: 'Pitch [mm]', tension: 'Tension',
    params_hint: 'On the rotor: 6, 12, 18, 24 or “receptie” for the tension at acceptance. Empty rows are ignored.',
  },

  sheet: {
    construction: 'Construction', wires_x_d: 'Wires × wire Ø [mm]', rope_d: 'Rope Ø / H × W [mm]', mass: 'Mass [g/m]', stranding: 'Stranding: pitch / tension on the rotor',
    reception: 'Tension at acceptance', die: 'Die', d_nominal: 'Nominal Ø [mm]', d_range: 'Ø min … max [mm]', h_l: 'H × W [mm]', destination: 'Destination', wires: 'No. of wires',
    cable_design: 'Conductor', cable_voltage: 'Voltage', cable_compounds: 'Insulation / sheath', cable_standard: 'Standard', cable_tests: 'Tests', cable_report: 'Report',
    r_max: 'R max [Ω/km]', mass_kgkm: 'Mass [kg/km]', wires_lita: 'Wires in the conductor', strands: 'Strands × wires', wire_d5: 'Wire Ø [mm]', suvita: 'Wire mass [g/m]', toron: 'Strand mass [g/m]', lita: 'Conductor mass [g/m]',
  },

  limitq: {
    r20: 'R max at 20 °C', funie_r20: 'R max at 20 °C', conductor_r20: 'R max at 20 °C', sarma_r20: 'R max at 20 °C', lita_r20: 'R max at 20 °C (finished conductor)',
    d: 'Ø', h: 'Height H', l: 'Width W', mass: 'Mass', suvita_mass: 'Wire mass', toron_mass: 'Strand mass', lita_mass: 'Conductor mass (approx.)', sarma_d: 'Wire Ø', sarma_mass: 'Wire mass',
  },

  iec: {
    wires_below_min: 'the number of wires {wires} is below the IEC 60228 Table 4 minimum ({min}) for the {shape} shape.',
    wires_below_min_exception: 'the number of wires {wires} is below the IEC 60228 Table 4 minimum ({min}) for the {shape} shape — accepted exception: {reason}',
    wires_missing: 'the number of wires is missing (IEC 60228 Table 4 requires at least {min}).',
    wires_missing_exception: 'the number of wires is missing — accepted exception: {reason}',
    class1_al_circular_only: 'IEC 60228 Table 3 note a: aluminium 10–35 mm² only circular, and {section} mm² is sector-shaped.',
    class1_al_circular_only_exception: 'IEC 60228 Table 3 note a: aluminium 10–35 mm² only circular — accepted exception: {reason}',
    wire_d_over_max: 'The wire Ø {d} mm exceeds the IEC 60228 Table 5 maximum ({max} mm).',
    wire_d_over_max_exception: 'The wire Ø {d} mm exceeds the IEC 60228 Table 5 maximum ({max} mm) — accepted exception: {reason}',
    limits_order: 'the limits for “{quantity}” are not consistent (min must be lower than max).',
    no_constructions: 'the revision contains no active construction.',
    iec_no_row: 'the section {section} mm² is not in the IEC 60228 table used for the check.',
    mass_vs_wires: 'the mass does not match the number of wires × the wire mass (ratio {ratio}); please check.',
  },

  stats: {
    title: 'Measurement statistics', heading: 'Statistics for {label}', hint: 'The mean, minimum, maximum and standard deviation of the current measurements, as a basis for setting the limits in a following revision.',
    mean: 'Mean', sd: 'Standard deviation', empty: 'There are no measurements for this construction yet.', link: 'Statistics',
  },

  lists: {
    title: 'Master data', intro: 'The lists can be completed, renamed and deactivated. An entry used in measurements is never deleted, only deactivated.',
    names: {
      machine_types: 'Machine types', machines: 'Machines', operators: 'Operators', clients: 'Clients', sample_types: 'Sample types', crews: 'Crews',
      shapes: 'Shapes', destinations: 'Destinations', materials: 'Material constants', compounds: 'Compounds (insulation / sheath)', cable_standards: 'Cable standards',
    },
    descriptions: {
      machine_types: 'The process and the allowed product families', machines: 'Name, type and rotor configuration', operators: 'First and last name', clients: 'Short name',
      sample_types: 'The list of sample types', crews: 'Crews A / B / C and the cycle start date', shapes: 'RE, RM, RMC, SM …', destinations: 'Single-wire, Multi-wire, Armoured …',
      materials: 'Resistivity, density, temperature coefficient', compounds: 'PVC, XLPE, HFFR … used on the cable sheets', cable_standards: 'IEC 60502-1, HD 603, VDE 0276-603 …',
    },
    fields: {
      name: 'Name', machine_type_id: 'Machine type', rotor_config: 'Rotor configuration', full_name: 'First and last name', short_name: 'Short name', numbered: 'Numbered', sort: 'Order',
      cycle_start: 'First day-shift day of the cycle', code: 'Code', kind: 'Kind', iec_group: 'IEC group', material: 'Material', grade: 'Grade', rho20: 'ρ20 [Ω·mm²/m]',
      compounds_code: 'Code', compounds_name: 'Name', density: 'Density δ [g/cm³]', alpha20: 'α20 [1/K]', clients_name: 'Full name', crews_name: 'Crew',
    },
    families: 'Allowed product families', crews_hint: 'Each crew has a 12-day cycle: 4 days, 2 off, 4 nights, 2 off. Enter the first day-shift day of each crew; crews A, B, C start 4 days apart.',
    machines_hint: 'The rotor configuration (for example 1+6+12+18) limits the constructions to those with enough wires; if left empty no capacity limit applies.',
    materials_hint: 'Changes are written to the audit log and apply to new measurements. All reference values (R max, ρ20) are at 20 °C, as in the standard.',
    kt_title: 'Temperature correction (IEC 60228, Annex B)', kt_rule: 'The reference point is 20 °C: a resistance measured at temperature t is brought to 20 °C with R20 = Rt × kt, kt = 1 / (1 + α20 · (t − 20)), with the α20 of the material. The theoretical resistance from mass is calculated directly at 20 °C (R20 = ρ20 / A). The other derived quantities use the formulas of the standard.',
    kt_a1: 'kt from Table A.1 (α = 0.004)', kt_ref: 'reference', kt_match: 'Check: the application formula with α = 0.004 reproduces all 41 values of Table A.1 (maximum difference {diff}).', kt_mismatch: 'Warning: the formula does not reproduce Table A.1 (maximum difference {diff}).', materials_check: 'Check: the temperature correction at 27 °C for copper is {kt}.',
  },

  users: {
    title: 'Users', new: 'New user', edit: 'Edit: {name}', username: 'User name', username_hint: 'Letters, digits, dot, hyphen or underscore (3–40).',
    full_name: 'Full name', role: 'Role', job_title: 'Job title', job_title_hint: 'For example QC, Process manager.', active_label: 'Active account', must_change: 'password must be changed',
    self_note: 'This is your account: you cannot deactivate it.', reset_title: 'Password reset', reset_hint: 'A one-time password is generated and shown only once; the user must change it at first login.',
    reset: 'Reset the password', reset_confirm: 'Reset this user\'s password? Their active sessions will be closed.',
    one_time_title: 'One-time password', one_time_for: 'One-time password for {name} ({username}):', one_time_hint: 'It is shown only once. Give it to the user; at first login they will be asked to change it.',
  },

  settings: {
    title: 'Settings', modules: 'Modules', modules_hint: 'The base application is QC measuring for conductors. The parts below are off until you switch them on; existing data is not lost.', mod_cable: 'Finished cable: tests, batches and certificates', mod_analytics: 'Analyses: trends, capability, control charts and alerts on the home page', server: 'Server', restart_notice: 'The port, the network address and the public name apply after the service restarts.', port: 'Port', bind: 'Network address',
    bind_hint: '0.0.0.0 = all interfaces; 127.0.0.1 = this computer only.', public_name: 'Public name', public_name_hint: 'For example ctc.romcab.local (registered by IT in DNS).',
    sessions: 'Sessions', idle_hours: 'Expiry after inactivity [hours]', shifts: 'Shifts', day_start: 'Start of the day shift', night_start: 'Start of the night shift',
    backup: 'Backup', backup_dir: 'Backup folder', backup_dir_hint: 'Local or network (\\\\server\\backup\\ctc). Empty = the default folder.', backup_time: 'Time of the daily backup',
    backup_keep: 'Number of copies kept', backup_auto: 'Automatic daily backup', backups: 'Backups', backup_folder: 'Current folder: {dir}', backup_now: 'Back up now',
    backup_failed: 'The backup failed', file: 'File', size: 'Size', restore: 'Restore', no_backups: 'There is no backup yet.',
    restore_title: 'Restoring the database', restore_warning: 'All current data will be replaced with the data from the backup. Before the restore, a safety copy of the current database is made automatically.',
    restore_file: 'Chosen file', restore_type: 'To confirm, type the file name', restore_type_hint: 'Copy the name shown above.', restore_do: 'Restore',
  },

  audit: {
    title: 'Audit log', action: 'Action', entity: 'Object', details: 'Details',
    actions: {
      login: 'login', login_failed: 'failed login', login_blocked: 'login blocked', logout: 'logout', password_change: 'password change', password_reset: 'password reset',
      user_create: 'user created', user_edit: 'user changed', measurement_add: 'measurement added', measurement_correct: 'measurement corrected',
      revision_new: 'new revision', revision_header: 'revision header', revision_submit: 'revision submitted', revision_verify: 'revision verified', revision_reject: 'revision rejected',
      construction_add: 'construction added', construction_edit: 'construction changed', construction_deactivate: 'construction deactivated', construction_activate: 'construction activated',
      setting_change: 'setting changed', backup: 'backup', backup_failed: 'backup failed', restore: 'restore', material_change: 'material constant',
      targets_change: 'targets changed', family_change: 'family changed', iec_add: 'IEC: value added', iec_change: 'IEC: value changed',
      list_add: 'list: added', list_edit: 'list: changed', list_toggle: 'list: status', forbidden: 'access denied', seed: 'initialisation',
    },
  },
};
