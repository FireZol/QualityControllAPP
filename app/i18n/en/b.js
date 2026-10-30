'use strict';
// English texts, part B (messages, login, home, entry form, register, detail).

module.exports = {
  errors: {
    num_required: 'The pattern is required.', num_too_long: 'The pattern is too long.', num_invalid: 'The pattern has characters or markers that are not allowed.', num_seq_once: 'The pattern must contain {seq} or {seq:N} exactly once.',
    required: 'Required field.', invalid: 'Invalid value.', too_long: 'The text is too long.', duplicate: 'An entry with this value already exists.',
    rotor_format: 'Expected format: numbers separated by +, for example 1+6+12+18.', capacity: 'The machine does not have enough layers for this construction.',
    password_short: 'The password must have at least 8 characters.', password_username: 'The password cannot be the same as the user name.',
    password_mismatch: 'The two passwords do not match.', password_same: 'The new password must differ from the current one.', password_wrong: 'The current password is not correct.',
    no_tests: 'Enter at least one test.', batch_closed: 'The batch is closed.',
    own_account: 'You cannot deactivate your own account.', last_admin: 'At least one active administrator must remain.',
    restore_mismatch: 'The typed name does not match the file name.',
  },

  flash: {
    saved: 'The changes were saved.', added: 'The entry was added.', toggled: 'The status was changed.', password_changed: 'The password was changed.',
    meeting_created: 'The meeting was created.', meeting_saved: 'The meeting was saved.', meeting_status_changed: 'The meeting status was changed.', meeting_decision_added: 'The decision was added.', meeting_attendance_saved: 'Attendance was saved.', series_saved: 'The schedule was saved.', task_bulk:'The selected tasks were changed.', task_bulk_partial: 'Some tasks were changed, others were not (for example they already had that status).', task_step_added: 'The steps were added.', ncr_created: 'The non-conformity was reported.', ncr_saved: 'The non-conformity was saved.', ncr_status_changed: 'The non-conformity status was changed.', ncr_comment_added: 'The comment was added.', ncr_task_added: 'The task was added.', e_disposition_required: 'Choose the decision on the product first (under Evaluation).', e_cause_required: 'Fill in the cause first (under Evaluation).', e_corrective_required: 'Fill in the corrective action first (under Evaluation).', e_verification_required: 'Verify the effectiveness of the action first.', pm_saved: 'The plan was saved.', pm_task_made: 'The task was made from the plan.', pm_skipped: 'The date was skipped; the plan moved to the next one.', e_pm_exists: 'This due date already has a task or was skipped.', e_nothing_selected: 'No task is selected.', e_bulk_none: 'No task could be changed.', task_created: 'The task was created.', task_saved: 'The task was saved.', task_status_changed: 'The task status was changed.', task_comment_added: 'The comment was added.',
    measurement_saved: 'The measurement was saved.',
    measurement_saved_temp: 'The measurement was saved. Warning: the temperature is outside the allowed range (Database → Targets and thresholds); the correction was calculated, but please check the value.',
    measurement_corrected: 'The correction was saved as a new version; the previous version stays in the history.',
    rev_created: 'The new revision (draft) was created from the active one.', rev_submitted: 'The revision was submitted for verification.',
    rev_verified: 'The revision was verified and activated; the previous revision was archived.', rev_rejected: 'The revision was rejected and returned to draft.',
    header_saved: 'The revision header was saved.', construction_saved: 'The construction was saved.', construction_toggled: 'The construction status was changed.',
    settings_saved_restart: 'The settings were saved. Changes of port, address or public name apply after the service restarts.',
    backup_done: 'The backup was created.', restore_done: 'The database was restored. If the session expired, log in again.',
    batch_created: 'The batch was created. Add the drums and the tests.', batch_closed: 'The batch was closed.', batch_reopened: 'The batch was reopened.', cert_issued: 'The certificate was issued.',
    e_batch_closed: 'The batch is closed.', e_no_results: 'There are no tests for this batch.',
    e_generic: 'The action could not be carried out.', e_invalid: 'The entered data is not valid.',
    e_open_revision_exists: 'A revision is already in progress for this document.', e_no_active_revision: 'The document has no active revision to start from.',
    e_later_stage: 'This product family is activated in a later stage.',
    e_not_author: 'Only the author can change or submit this draft.', e_not_draft: 'The revision is no longer a draft.',
    e_not_in_verification: 'The revision is not in verification.', e_author_cannot_verify: 'The author cannot verify their own revision.',
    e_forbidden: 'You are not allowed to perform this action.', e_reason_required: 'The reason is required.',
    e_iec_errors: 'The revision does not comply with IEC 60228; see the checks below.', e_edition_revision_taken: 'This edition + revision combination already exists for this document.',
    e_not_found: 'The item was not found.', verify_checked: 'The row was ticked as checked.', verify_all: 'All rows are checked against the original.', e_verify_closed: 'The revision is no longer in progress; the check can no longer be changed.', golive_done: 'The test measurements were deleted. Production has started; the backup made just before is in the backup list.',
    e_golive_done: 'Production has already started; this cannot be repeated.', e_golive_backup: 'The backup failed; nothing was deleted.',
    e_restore_bad_name: 'The backup file name is not valid.', e_restore_not_found: 'The backup file was not found.',
    e_restore_invalid_backup: 'The chosen file is not a valid database.', e_restore_safety_failed: 'The safety copy of the current database could not be made; the restore was stopped.',
  },

  error_pages: {
    home: 'Back to the start page',
    not_found: { title: 'Page not found', text: 'The address does not exist or the item you were looking for is no longer available.' },
    forbidden: { title: 'Access denied', text: 'You are not allowed to open this page or to perform this action.' },
    csrf: { title: 'Request rejected', text: 'The form expired or did not come from the application. Reload the page and try again.' },
    server_error: { title: 'Internal error', text: 'An unexpected error occurred. The existing data was not affected. Tell the administrator if the problem persists.' },
    maintenance: { title: 'The application is under maintenance', text: 'A restore or an update is in progress. Try again in a few seconds.' },
  },

  login: {
    title: 'Log in', username: 'User name', password: 'Password', submit: 'Log in',
    failed: 'Wrong user name or password.',
    locked: 'Too many failed attempts. The account is temporarily locked; try again in {minutes} min.',
  },

  password: {
    title: 'Change password', forced: 'You must change your password before continuing.', current: 'Current password', new: 'New password',
    confirm: 'Confirm the new password', hint: 'At least 8 characters.', submit: 'Change password',
  },

  home: { att_ncr_late: 'Non-conformities to evaluate: {n} ({late} overdue)', att_ncr: 'Non-conformities to evaluate: {n}', items_n: '{n} items',
    side_meetings: 'Meetings', no_meetings: 'No meetings in the next 7 days.', att_meetings: 'Meetings today: {n}',
    greet_morning: 'Good morning', greet_afternoon: 'Good afternoon', greet_evening: 'Good evening', attention: 'Needs your attention', attention_none: 'All clear — nothing is waiting for you.', att_out: 'Measurements with out-of-limit values (24 h): {n}', att_spc: 'SPC alerts: {n}', att_setup: 'First-setup steps left: {n}', att_overdue: 'Overdue tasks: {n}', att_unread: 'Unread notifications: {n}', att_mine: 'Open tasks assigned to you: {n}', quick: 'Quick actions', tile_today: 'Measurements today', tile_out: 'Out of limits (24 h)', tile_sheets: 'Active data sheets', tile_tasks: 'Active tasks', tile_overdue: 'overdue', side_shift: 'On shift now', side_tasks: 'My tasks', side_notes: 'Recent notifications', see_all: 'See all', no_tasks_mine: 'No tasks assigned to you.', no_notes: 'No notifications.', new_task: 'New task', crew_none: 'no crew',
    title: 'Home', new_measurement: 'New measurement', current_shift: 'Current shift: {shift} · crew {crew}',
    setup_title: 'First setup', setup_hint: 'The steps below tick themselves off. The panel disappears once all are done.',
    setup_engineers: 'At least two Engineers (one drafts a sheet, the other verifies and activates it)', setup_sheets: 'Active data sheets, so that measurements can be entered',
    setup_crews: 'The start dates of crews A / B / C (until then they are placeholders)', setup_backup: 'At least one backup (Settings → Back up now)',
    setup_now: 'now {n}', setup_sheets_n: '{n} of {total} active',
    today: 'Today\'s measurements (current shift first)', today_empty: 'No measurement recorded today.', start_first: 'Start the first measurement »',
    spc: 'SPC signals (process drift)', spc_hint: 'Products whose latest values break a control rule, even though they are still within limits. The control limits are calculated from the earlier values.',
    out_of_limit: 'Results out of limits — last 24 hours', out_empty: 'No out-of-limit value in the last 24 hours.', results: 'Values',
  },

  quantity: {
    d: 'Ø', d1: 'Ø reading 1', d2: 'Ø reading 2', d_avg: 'Mean Ø', ovality: 'Ovality', h: 'Height H', l: 'Width W', mass_gm: 'Mass [g/m]',
    r_max_finished: 'R max of the finished conductor [Ω/km]', d_ech: 'Equivalent Ø from mass', r20_theor: 'Theoretical R20 [Ω/km]', r20: 'Measured R20 [Ω/km]', r20_echiv: 'R20 of the strand reported to the bunched conductor [Ω/km]', r_max: 'R max at 20 °C [Ω/km]',
  },

  input: {
    d1: 'Ø reading 1 [mm]', d2: 'Ø reading 2, perpendicular [mm]', h: 'Height H [mm]', l: 'Width W [mm]', mass_g: 'Sample mass [g]',
    sample_mm: 'Sample length [mm]', r_value: 'Measured resistance', r_unit: 'Unit', r_sample_m: 'Resistance sample length [m]', temp_c: 'Temperature [°C]',
  },

  tests: { parts: { avg: 'average', min: 'minimum', max: 'maximum' } },

  level: { suvita: 'Wire', toron: 'Strand', lita: 'Bunched conductor' },

  measure: {
    level: 'Measured level', title: 'New measurement', family: 'Product family', machine: 'Machine', construction: 'Product (section and shape)', choose: '— choose —',
    no_machines: 'There is no active machine for this family. An Engineer or the Administrator has to add one under Database → Machines.',
    no_constructions: 'The active data sheet has no products suitable for this machine. Most often the sheet has no active revision yet: an Engineer verifies it and a second Engineer activates it. See:',
    active_revision: 'Active data sheet: Ed. {edition}, Rev. {revision} — {doc}',
    limits_caption: 'Limits from the active data sheet', nominal: 'Nominal', limits: 'Limits', source: 'Source', source_sheet: 'data sheet', informative_note: 'informative, no verdict',
    sample_data: 'Sample data', operator: 'Operator', client: 'Client', sample_type: 'Sample type', none_selected: '— unspecified —',
    length_no: 'Length no.', length_no_hint: 'Proposed automatically for numbered samples.',
    values: 'Measured values', sample_mm_hint: 'Default {n} mm.', r_optional: 'Optional. Resistance is measured for the materials enabled for the family (Database → Product families).', r_sample_hint: 'Default {n} m, 2 m for large sections.',
    produced_length: 'Produced length [m]', optional: 'Optional.', notes: 'Notes',
    live_title: 'Result before saving', live_hint: 'The results appear here as you enter the values. Out-of-limit values are flagged but never block saving.',
    wire_mass_hint: 'Wire mass: g/m equals kg/km (the unit on the sheet).',
    banner_ok: '✓ Within limits', banner_out: '✗ Out of limits: {list}', banner_undef: 'No verdict (limits missing)',
    save: 'Save the measurement', cell_empty: 'Fill in the values to see the result.', temp_warning: 'The temperature is outside the allowed range ({min} … {max} °C).',
  },

  register: {
    title: 'Measurement register', shift: 'Shift', crew: 'Crew', product: 'Product', only_out: 'Only with out-of-limit values', all_versions: 'Also show old versions',
    count: '{total} records', no: 'No.', diameter: 'Ø / H × W [mm]', versions: '{n} versions', versions_title: 'The record has several versions (corrections)',
    more_filters: 'More filters', empty: 'No record for the chosen filters.', clear_filters: 'Clear the filters', add_first: 'Add a measurement',
  },

  detail: { report_ncr: 'Report non-conformity',
    title: 'Record no. {no}', quantity: 'Quantity', value: 'Value', limits: 'Limits', verdict: 'Verdict', deviation: 'Deviation from R max', source: 'Limit source',
    calculated: 'calculated', sheet_revision: 'Data sheet used', ed_rev: 'Ed. {edition}, Rev. {revision}',
    correct: 'Correct', denied_not_own: 'Staff can only correct their own records.', denied_other_shift: 'Staff can only correct within the same shift.',
    denied_not_found: '', new_same: 'New measurement, same product', versions: 'Versions and history', version_n: 'Version {n}', current: 'current', superseded: 'superseded',
    saved_by: 'Saved by', reason: 'reason', correction_reason: 'Reason for the correction', correction_reason_label: 'Why is the record being corrected?',
    save_correction: 'Save the correction (new version)', correct_title: 'Correcting record no. {no}',
    correct_hint: 'Version {version} is created. The previous version stays in the history. The record keeps its original data sheet, shift and crew.',
  },

  status: { ciorna: 'draft', in_verificare: 'in verification', activa: 'active', arhivata: 'archived' },
};
