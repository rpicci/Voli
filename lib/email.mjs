import { Resend } from "resend";

export async function sendResultsEmail({ apiKey, from, to, results, searchLabel }) {
  const resend = new Resend(apiKey);
  const sorted = [...results].sort((a, b) => a.price - b.price);
  const top = sorted.slice(0, 15);

  const rows = top
    .map(
      (r) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #2a2f3a;">${r.origin} → ${r.destination}</td>
        <td style="padding:8px;border-bottom:1px solid #2a2f3a;">${r.departDate}${r.departTime ? " " + r.departTime : ""}</td>
        <td style="padding:8px;border-bottom:1px solid #2a2f3a;">${r.stops ?? "?"} scali</td>
        <td style="padding:8px;border-bottom:1px solid #2a2f3a;">${r.airline || "—"}${r.flightNumber ? " " + r.flightNumber : ""}</td>
        <td style="padding:8px;border-bottom:1px solid #2a2f3a;font-weight:bold;">${r.price} ${r.currency}</td>
        <td style="padding:8px;border-bottom:1px solid #2a2f3a;">${r.source}</td>
      </tr>`
    )
    .join("");

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
      <h2 style="color:#1a1a1a;">✈️ Flight Watch — ${searchLabel}</h2>
      <p>Trovati ${results.length} voli che rispettano i tuoi criteri. I 15 più economici:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f4f4f4;text-align:left;">
            <th style="padding:8px;">Rotta</th>
            <th style="padding:8px;">Data / ora</th>
            <th style="padding:8px;">Scali</th>
            <th style="padding:8px;">Volo</th>
            <th style="padding:8px;">Prezzo</th>
            <th style="padding:8px;">Fonte</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;">
        I link di prenotazione precisi vanno verificati sul sito della fonte.
      </p>
    </div>
  `;

  return resend.emails.send({
    from,
    to,
    subject: `✈️ ${results.length} voli trovati — ${searchLabel}`,
    html,
  });
}

export async function sendStatusEmail({ apiKey, from, to, message, subject }) {
  const resend = new Resend(apiKey);
  return resend.emails.send({
    from,
    to,
    subject,
    html: `<p style="font-family:sans-serif;">${message}</p>`,
  });
}
