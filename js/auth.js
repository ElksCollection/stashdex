// Inlogschermen: inloggen, wachtwoord vergeten en nieuw wachtwoord kiezen
import { supabase, remember, setRemember, recoveryLink, linkError, explain } from "./supabase-client.js";

const $ = (id) => document.getElementById(id);
const screens = ["login", "forgot", "newpw", "home"];
let recovering = recoveryLink;

// Toont precies één scherm
function show(screen) {
  screens.forEach((s) => ($(s).hidden = s !== screen));
}

// Start de inlogschermen; onEnter(session) opent de app, onLeave() sluit hem
export function startAuth({ onEnter, onLeave }) {
  // Kiest het juiste scherm op basis van wel/niet ingelogd
  function render(session) {
    if (session && recovering) return show("newpw");
    if (!session) {
      onLeave();
      return show("login");
    }
    show("home");
    onEnter(session);
  }

  // Vinkje staat zoals je het de vorige keer achterliet
  $("remember").checked = remember();
  if (linkError) {
    $("error").textContent = `De link uit de mail werkt niet (meer): ${linkError}. Vraag een nieuwe aan via "Wachtwoord vergeten?".`;
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("error").textContent = "";
    $("loginNotice").textContent = "";
    // Eerst de keuze opslaan, zodat de sessie meteen op de juiste plek belandt
    setRemember($("remember").checked);
    $("loginBtn").disabled = true;
    const { error } = await supabase.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value,
    });
    $("loginBtn").disabled = false;
    if (error) $("error").textContent = `Inloggen mislukt: ${explain(error)}`;
  });

  $("toForgot").addEventListener("click", () => {
    $("forgotEmail").value = $("email").value.trim();
    $("forgotError").textContent = "";
    $("forgotNotice").textContent = "";
    show("forgot");
  });

  $("toLogin").addEventListener("click", () => show("login"));

  $("forgotForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("forgotError").textContent = "";
    $("forgotNotice").textContent = "";
    $("forgotBtn").disabled = true;
    const { error } = await supabase.auth.resetPasswordForEmail($("forgotEmail").value.trim(), {
      redirectTo: location.origin + location.pathname,
    });
    $("forgotBtn").disabled = false;
    if (error) return ($("forgotError").textContent = `Mail versturen mislukt: ${explain(error)}`);
    // Zegt bewust niet of het adres bestaat, zodat niemand zo accounts kan raden
    $("forgotNotice").textContent = "Als dit adres bij Stashdex bekend is, krijg je binnen een paar minuten een mail. Kijk ook in je spam.";
  });

  $("newpwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("newpwError").textContent = "";
    if ($("newPassword").value !== $("newPassword2").value) {
      return ($("newpwError").textContent = "De twee wachtwoorden zijn niet hetzelfde.");
    }
    $("newpwBtn").disabled = true;
    const { error } = await supabase.auth.updateUser({ password: $("newPassword").value });
    $("newpwBtn").disabled = false;
    if (error) return ($("newpwError").textContent = `Opslaan mislukt: ${explain(error)}`);
    recovering = false;
    history.replaceState(null, "", location.pathname);
    $("newPassword").value = $("newPassword2").value = "";
    const { data } = await supabase.auth.getSession();
    render(data.session);
    window.dispatchEvent(new CustomEvent("stashdex-toast", { detail: "Je nieuwe wachtwoord is opgeslagen" }));
  });

  // Reageert op inloggen/uitloggen, ook bij het openen van de pagina
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") recovering = true;
    setTimeout(() => render(session), 0);
  });
}
