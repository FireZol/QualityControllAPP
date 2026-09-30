'use strict';
// Printed batch certificate and type test report (A4, numbered pages, same frame as the data sheets).
const { html } = require('../lib/html');
const { T, f } = require('../i18n');
const calc = require('../domain/calc');
const { displayDate } = require('../lib/time');
const P = require('./print');
const { designLine } = require('./cable');

const VERDICT_CLASS = { ok: 'ok', sub: 'bad', peste: 'bad', neconform: 'bad', nedeterminat: 'na', info: 'na' };

function resultTable(rows, showDrum) {
  const head = [...(showDrum ? [T.cable.drum] : []), T.cable.test, T.detail.value, T.cable.unit, T.cable.requirement, T.cable.result];
  return P.table(head, rows.map((r) => html`<tr class="r-${VERDICT_CLASS[r.verdict]}">${showDrum ? html`<td>${r.drum || T.cable.whole_batch}</td>` : ''}<td>${r.test}${r.external ? html` <sup title="${T.cable.external_title}">†</sup>` : ''}</td>
    <td class="num">${r.value}</td><td>${r.unit}</td><td>${r.limit || T.common.none}</td><td class="verd">${T.verdict[r.verdict]}</td></tr>`));
}

function sections(rows, showDrum) {
  const out = [];
  for (const scope of ['routine', 'sample', 'type']) {
    const list = rows.filter((r) => r.scope === scope);
    if (list.length) out.push(html`<h2>${T.cable.scopes[scope]}</h2>${resultTable(list, showDrum)}`);
  }
  return out;
}

function footer(d) {
  return html`<div class="doc-foot">
    <div><span class="k">${T.print.elaborated}:</span> ${d.by || ''} <span class="muted">${displayDate(d.at)}</span></div>
    <div><span class="k">${T.specs.verified}:</span> <span class="sigline"></span></div>
    <div><span class="k">${T.print.signature}:</span> <span class="sigline"></span></div>
    <div><span class="k">${T.print.copy}:</span> ${d.exemplar || ''}</div></div>`;
}

function certificatePage(ctx, d) {
  const { snap, preview, cert, exemplar, back } = d;
  const b = snap.batch;
  const facts = html`<table class="sheet facts-table"><tbody>
    <tr><th>${T.cable.batch}</th><td>${b.batch_no}</td><th>${T.cable.order}</th><td>${b.order_no || T.common.none}</td></tr>
    <tr><th>${T.measure.client}</th><td>${b.client || T.common.none}</td><th>${T.cable.standard}</th><td>${b.standard || T.common.none}</td></tr>
    <tr><th>${T.cable.design}</th><td colspan="3"><strong>${snap.design.label}</strong> — ${designLine({ ...snap.design, data: snap.design.data })}</td></tr>
    <tr><th>${T.cable.produced_length}</th><td>${b.produced_length_m ? calc.formatNumber(b.produced_length_m, 0, 1) + ' m' : T.common.none}</td><th>${T.cable.produced_on}</th><td>${displayDate(b.produced_on) || T.common.none}</td></tr>
    <tr><th>${T.cable.sheet}</th><td colspan="3">${snap.sheet.title} — ${f(T.detail.ed_rev, { edition: snap.sheet.edition, revision: snap.sheet.revision })}${snap.sheet.code ? ` · ${snap.sheet.code}` : ''}</td></tr></tbody></table>`;
  const drums = snap.drums.length ? html`<p class="small"><strong>${T.cable.drums}:</strong> ${snap.drums.map((x) => `${x.drum_no}${x.length_m ? ' (' + calc.formatNumber(x.length_m, 0, 1) + ' m)' : ''}`).join(', ')}</p>` : '';
  const conclusion = html`<div class="conclusion ${snap.conforming ? 'c-ok' : 'c-bad'}"><strong>${T.cable.conclusion}:</strong>
    ${snap.conforming ? T.cable.conforming_text : T.cable.nonconforming_text} ${snap.override_reason ? html`<div>${T.cable.override_reason}: <em>${snap.override_reason}</em></div>` : ''}</div>`;
  const content = html`${facts}${drums}${sections(snap.rows, true)}
    ${snap.rows.some((r) => r.external) ? html`<p class="small">† ${T.cable.external_note}</p>` : ''}
    ${snap.hidden_count ? html`<p class="small muted">${f(T.cable.hidden_note, { n: snap.hidden_count })}</p>` : ''}
    ${preview && snap.missing.length ? html`<div class="notes"><strong>${T.cable.missing}</strong><ul>${snap.missing.map((m) => html`<li>${m.test}${m.drum ? ` — ${T.cable.drum} ${m.drum}` : ''}</li>`)}</ul></div>` : ''}
    ${conclusion}`;
  const statusNote = preview ? T.cable.preview_banner : (cert && cert.superseded_by ? f(T.cable.superseded_banner, { no: cert.superseded_by }) : '');
  const metaHtml = html`<dl class="doc-meta"><div><dt>${T.cable.cert_no}</dt><dd>${cert ? cert.cert_no : T.cable.draft}</dd></div><div><dt>${T.common.date}</dt><dd>${displayDate(cert ? cert.issued_at : new Date().toISOString())}</dd></div></dl>`;
  return P.page({
    title: `${T.cable.certificate} ${cert ? cert.cert_no : b.batch_no}`,
    toolbar: P.toolbar(ctx, { backHref: back, action: cert ? `/certificate/${cert.id}` : `/loturi/${d.batchId}/certificat`, withExemplar: true, exemplar, fixedLanguage: !!cert }),
    body: P.frame({ company: snap.company, title: T.cable.certificate_title, metaHtml, statusNote, footer: footer({ by: cert ? cert.issued_by_name : ctx.user.full_name, at: cert ? cert.issued_at : new Date().toISOString(), exemplar }), content }),
  });
}

function typeReportPage(ctx, d) {
  const { rep, exemplar, back, id } = d;
  const content = html`<table class="sheet facts-table"><tbody>
    <tr><th>${T.cable.design}</th><td colspan="3"><strong>${rep.design.label}</strong> — ${designLine(rep.design)}</td></tr>
    <tr><th>${T.cable.sheet}</th><td colspan="3">${rep.revision.doc_title} — ${f(T.detail.ed_rev, { edition: rep.revision.edition, revision: rep.revision.revision })}</td></tr></tbody></table>
    ${rep.rows.length ? sections(rep.rows, false) : html`<p>${T.cable.no_type_results}</p>`}
    ${rep.rows.some((r) => r.external) ? html`<p class="small">† ${T.cable.external_note}</p>` : ''}
    ${rep.notes.length ? html`<div class="notes"><strong>${T.common.notes}</strong><ul>${rep.notes.map((n) => html`<li>#${n.record_no}: ${n.notes}</li>`)}</ul></div>` : ''}
    <div class="conclusion ${rep.conforming ? 'c-ok' : 'c-bad'}"><strong>${T.cable.conclusion}:</strong> ${rep.conforming ? T.cable.type_conforming : T.cable.type_nonconforming}</div>`;
  return P.page({
    title: T.cable.type_report,
    toolbar: P.toolbar(ctx, { backHref: back, action: `/proiecte-cablu/${id}/raport-tip`, withExemplar: true, exemplar }),
    body: P.frame({ company: rep.company, title: T.cable.type_report, noMeta: true, statusNote: '', footer: footer({ by: ctx.user.full_name, at: new Date().toISOString(), exemplar }), content }),
  });
}

module.exports = { certificatePage, typeReportPage };
