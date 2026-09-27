// Verbinding met Supabase (inloggen + database), gedeeld door de hele app
// Vaste versie, zodat er nooit ongemerkt andere code binnenkomt
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

// Browseropslag kan geblokkeerd zijn (privévenster); dan gewoon doorgaan zonder
export const safe = (fn) => { try { return fn(); } catch { return null; } };

// "Onthoud mij": aan = sessie in localStorage (blijft na afsluiten), uit = sessionStorage (weg na sluiten tabblad)
const REMEMBER_KEY = "stashdex-onthoud-mij";
export const remember = () => safe(() => localStorage.getItem(REMEMBER_KEY)) !== "nee";
export const setRemember = (on) => safe(() => localStorage.setItem(REMEMBER_KEY, on ? "ja" : "nee"));
const storage = {
  getItem: (key) => safe(() => sessionStorage.getItem(key)) ?? safe(() => localStorage.getItem(key)),
  setItem: (key, value) => {
    const keep = remember();
    safe(() => (keep ? localStorage : sessionStorage).setItem(key, value));
    safe(() => (keep ? sessionStorage : localStorage).removeItem(key));
  },
  removeItem: (key) => {
    safe(() => sessionStorage.removeItem(key));
    safe(() => localStorage.removeItem(key));
  },
};

// Link uit de "wachtwoord vergeten"-mail uitlezen, vóórdat Supabase het adres opschoont
const hash = new URLSearchParams(location.hash.slice(1));
export const recoveryLink = hash.get("type") === "recovery";
export const linkError = hash.get("error_description");
if (linkError) history.replaceState(null, "", location.pathname);

// Openbare verbindingsgegevens; de beveiliging zit in login + RLS in Supabase
export const supabase = createClient(
  "https://iffsbsywjzmcmxsjhikd.supabase.co",
  "sb_publishable_y9pL7nfJLtZPdwTtQa5WTg_ewt3OtEj",
  // "implicit": de link uit de mail werkt ook in een ander tabblad of andere browser
  { auth: { storage, persistSession: true, detectSessionInUrl: true, flowType: "implicit" } }
);

// Duidelijke melding per oorzaak, met de technische code erbij voor het zoeken naar de fout
const reasons = {
  invalid_credentials: "E-mail of wachtwoord klopt niet.",
  email_not_confirmed: "Dit e-mailadres is nog niet bevestigd in Supabase.",
  over_request_rate_limit: "Te veel pogingen, probeer het over een paar minuten opnieuw.",
  over_email_send_rate_limit: "Er zijn te veel mails verstuurd, probeer het later opnieuw.",
  same_password: "Dit is hetzelfde als je oude wachtwoord.",
  weak_password: "Dit wachtwoord is te zwak, kies een langer of lastiger wachtwoord.",
};
export const explain = (error) => `${reasons[error.code] || error.message} (${error.code || error.status})`;
