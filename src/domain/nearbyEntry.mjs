export function nearbyInitialTab(value) {
  return value === "shows" ? "shows" : "venues";
}

export function nearbyLocationPrompt(center) {
  const hasCity = typeof center?.city === "string" && !!center.city.trim();
  return hasCity ? {
    title: "This city is not mapped yet",
    body: "Choose another city to see nearby venues and shows.",
  } : {
    title: "Choose a city to find shows",
    body: "Pick a city to see its upcoming concerts and venues. You can browse anywhere.",
  };
}
