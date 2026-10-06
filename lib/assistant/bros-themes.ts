export const BROS_THEME_NOTES = {
  classic:["Frisch gestapelt, ganz klassisch. Ich helfe dir, deinen Lieblingsburger zu finden.","confetti"],
  lights:["Berlin Lights: Lichtkunst macht unsere Stadt bunt. Ich habe meine kleine Lichtshow mitgebracht!","beam"],
  neon:["Mein kleiner Neon-Kristall leuchtet! Schau, wie die Farben tanzen.","beam"],
  halloween:["Buh! Halloween wird am 31. Oktober gefeiert. Mein Kürbis und ich sind schon bereit!","bats"],
  christmas:["Eine schöne Adventszeit! Ich schmücke meinen kleinen Baum und wünsche dir gemütliche Momente.","snow"],
  weihnachten:["Frohe Weihnachten! Ich habe ein kleines Geschenk mitgebracht. Schau, was darin funkelt!","snow"],
  veganweek:["Grüne Grüße zur Vegan-Woche! Bei mir sprießt schon ein Pflänzchen. Unsere veganen Optionen findest du im Menü.","leaves"],
  autumn:["Ein Blatt tanzt vorbei, und ich fange es auf! Willkommen in unserer gemütlichen Herbststimmung.","leaves"],
  winter:["Winterzauber in meiner kleinen Schneekugel! Mach es dir gemütlich und entdecke deinen Lieblingsburger.","snow"],
  newyear:["Ein frohes neues Jahr! Drei, zwei, eins: Meine kleine Rakete startet mit bunten Sternen!","fireworks"],
  anniversary:["Zeit zum Feiern! Ich bringe einen kleinen Kuchen und wünsche dir einen wundervollen Tag.","fireworks"],
  valentines:["Alles Liebe zum Valentinstag! Ich zeichne dir ein kleines Herz. Liebe geht auch durch einen guten Burger.","hearts"],
  womensday:["Alles Liebe zum Internationalen Frauentag! Ich habe ein paar Tulpen für dich mitgebracht.","hearts"],
  mothersday:["Alles Liebe zum Muttertag! Diese Blumen sind für alle Mamas. Schön, dass du da bist!","hearts"],
  fathersday:["Alles Liebe zum Vatertag! Für alle Papas habe ich ein kleines Geschenk mit Schleife dabei.","confetti"],
  easter:["Frohe Osterzeit! Ich habe ein buntes Ei bemalt. Welcher Burger darf es für dich sein?","confetti"],
  summer:["Sonnige Grüße! Mein kleines Erfrischungsgetränk ist bereit. Die echten Getränke findest du im Menü.","confetti"],
  school:["Ob Zeugnis oder Schulstart: Du kannst stolz auf deinen Einsatz sein! Ich schlage schon mein kleines Zeugnisheft auf.","confetti"],
  fan:["Los geht’s, Fans! Ich probiere einen kleinen Trick mit meinem Fußball. Welchen Burger möchtest du?","confetti"],
  germany:["Schwarz, Rot und Gold: Ich winke dir im Deutschland-Look zu. Schön, dass du hier bist!","confetti"],
  oktoberfest:["Servus zur Oktoberfest-Stimmung! Meine kleine Brezel ist Teil der Show; bestellen kannst du aus unserem Menü.","confetti"],
  blackweek:["Mein kleiner Angebotsanhänger ist bereit! Die tatsächlich gültigen Preise und Aktionen findest du im Menü.","confetti"],
  medicine:["Danke an alle, die sich um unsere Gesundheit kümmern! Zum Tag der Medizin trage ich Kittel und Stethoskop.","hearts"],
  ramadan:["Ich wünsche dir eine friedliche Ramadan-Zeit. Meine kleine Laterne bringt einen warmen Gruß.","stars"],
  retrowave:["Retrofarben und meine kleine Kassette: Jetzt kommt eine bunte Lichtshow!","beam"],
  arcade:["Spielerische Grüße! Ich probiere meinen kleinen Controller aus. Deinen Burger wählen wir im Menü.","stars"],
  popart:["Ein bisschen Farbe, eine lustige Pose: Willkommen in meiner kleinen Pop-Art-Welt!","stars"],
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
