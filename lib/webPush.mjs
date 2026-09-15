import webpush from "web-push";

// Invia una notifica push al dispositivo sottoscritto. Un solo dispositivo
// alla volta è supportato: save-push-subscription.mjs sovrascrive sempre
// l'unica sottoscrizione salvata, quindi qui leggiamo/usiamo un solo record.
//
// Richiede tre variabili d'ambiente su Netlify:
// - VAPID_PUBLIC_KEY
// - VAPID_PRIVATE_KEY
// - VAPID_SUBJECT (es. "mailto:tuo@indirizzo.it" — richiesto dallo standard,
//   usato dai provider push per contattarti in caso di abuso, non inviato
//   né mostrato mai all'utente)

export async function sendPushNotification(subscriptionStore, { title, body, url }) {
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.log("[push] Variabili VAPID mancanti, notifica push saltata.");
    return { sent: false, reason: "VAPID non configurato" };
  }

  const subscription = await subscriptionStore.get("subscription", { type: "json" });
  if (!subscription) {
    console.log("[push] Nessun dispositivo sottoscritto, notifica push saltata.");
    return { sent: false, reason: "Nessuna sottoscrizione" };
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body, url: url || "/" })
    );
    return { sent: true };
  } catch (err) {
    // Codice 410 (Gone) o 404: la sottoscrizione non è più valida (utente ha
    // disinstallato la PWA, revocato il permesso, ecc.) — la rimuoviamo per
    // evitare di ritentare inutilmente ad ogni esecuzione futura.
    if (err.statusCode === 410 || err.statusCode === 404) {
      await subscriptionStore.delete("subscription");
      console.log("[push] Sottoscrizione non più valida, rimossa.");
      return { sent: false, reason: "Sottoscrizione scaduta, rimossa" };
    }
    console.log(`[push] Errore invio notifica: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}
