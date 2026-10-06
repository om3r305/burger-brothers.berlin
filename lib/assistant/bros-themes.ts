export const BROS_THEME_NOTES = {
  classic:["Frisch gestapelt, ganz klassisch. Ich helfe dir, deinen Lieblingsburger zu finden.","confetti"],
  lights:["Berlin Lights: Lichtkunst macht unsere Stadt bunt. Ich habe meine kleine Lichtshow mitgebracht!","beam"],
  neon:["Heute wird es neonbunt. Schau mal, meine kleine Lichtshow!","beam"],
  halloween:["Buh! Halloween wird am 31. Oktober gefeiert. Mein Kürbis und ich sind schon bereit!","bats"],
  christmas:["Adventszeit: Lichter, Vorfreude und ein warmer Burger. Ich bin im Weihnachtslook!","snow"],
  weihnachten:["Frohe Weihnachtszeit! Ich habe meine Weihnachtsmütze und ein paar Schneeflocken mitgebracht.","snow"],
  veganweek:["Der Weltvegantag ist am 1. November. Entdecke unsere veganen Optionen im Menü!","leaves"],
  autumn:["Herbstfarben und raschelnde Blätter. Ich sammle schon Ideen für deinen nächsten Burger.","leaves"],
  winter:["Draußen Winterstimmung, hier ein warmer Burger. Mein Schal sitzt schon!","snow"],
  newyear:["Ein neues Jahr, neue Lieblingsburger. Meine kleine Konfetti-Show ist bereit!","fireworks"],
  anniversary:["Zeit zum Feiern! Zur Geburtstagsstimmung bringe ich ein bisschen Konfetti mit.","fireworks"],
  valentines:["Valentinstag ist am 14. Februar. Liebe geht auch durch einen guten Burger!","hearts"],
  womensday:["Am 8. März ist Internationaler Frauentag. Ich bringe heute Blumen und gute Laune mit.","hearts"],
  mothersday:["Ein lieber Gruß zum Muttertagslook. Zeit, jemandem eine Freude zu machen!","hearts"],
  fathersday:["Mit Fliege und guter Laune: Heute passe ich zum Vatertagslook.","confetti"],
  easter:["Zum Osterlook habe ich meine Hasenohren aufgesetzt. Entdeckst du deinen Lieblingsburger?","confetti"],
  summer:["Sommerfarben, Sonnenbrille und gute Laune. Ich helfe dir auch bei der Getränkeauswahl.","confetti"],
  school:["Zum Schulstart-Look trage ich meinen kleinen Hut. Lass uns deinen Lieblingsburger finden!","confetti"],
  fan:["Fan-Stimmung! Mein kleiner Fußball ist dabei. Die Burgerauswahl findest du im Menü.","confetti"],
  germany:["Schwarz, Rot und Gold: Mein Schal passt heute zum Deutschland-Look.","confetti"],
  oktoberfest:["Oktoberfest-Stimmung: Ich habe meinen kleinen Trachtenhut dabei. Servus!","confetti"],
  blackweek:["Black-Week-Look! Welche Angebote wirklich gelten, siehst du bei den Artikeln im Menü.","confetti"],
  medicine:["Heute trage ich den kleinen Erste-Hilfe-Anstecker passend zum Themenlook.","hearts"],
  ramadan:["Ein lieber Gruß zum Ramadan-Look. Mein kleiner goldener Halbmond leuchtet mit.","stars"],
  retrowave:["Retrofarben und eine kleine Lichtshow. Willkommen in meinem Retrowave-Look!","beam"],
  arcade:["Arcade-Stimmung! Mein kleiner Spiele-Look ist bereit. Deinen Burger wählen wir im Menü.","stars"],
  popart:["Bunte Farben, kleine Sternchen: Heute bin ich im Pop-Art-Look unterwegs.","stars"],
} as const;
export type BrosTheme = keyof typeof BROS_THEME_NOTES;
export type BrosEffect = typeof BROS_THEME_NOTES[BrosTheme][1];
export function normalizeBrosTheme(value:unknown):BrosTheme {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BROS_THEME_NOTES,value) ? value as BrosTheme : "classic";
}
export function brosThemeNote(value:unknown, now=new Date()) {
  const theme=normalizeBrosTheme(value);
  const [fallback,effect]=BROS_THEME_NOTES[theme];
  const day=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  // Verified official 2026 dates. Other years use timeless wording, never guessed events.
  let text:string=fallback;
  if(theme==="lights" && day>="2026-10-01" && day<"2026-10-09") text="Bald leuchtet Berlin! Das Festival of Lights läuft vom 9. bis 18. Oktober. Meine kleine Lichtshow startet schon jetzt.";
  else if(theme==="lights" && day>="2026-10-09" && day<="2026-10-18") text="Festival of Lights in Berlin: vom 9. bis 18. Oktober, jeden Abend von 19 bis 23 Uhr. Hier kommt meine kleine Lichtshow!";
  return {theme,text,effect,day};
}
