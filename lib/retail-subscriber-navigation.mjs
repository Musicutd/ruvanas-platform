// These shortcuts are a presentation of the existing, permission-filtered
// navigation. Only the resolved Retail planning workspace opts into this view.
export function retailSubscriberShortcuts({ navigation = [], enabled = false } = {}) {
  if (!enabled) return null;
  const items = navigation.flatMap(section => section.items).filter(item => item.available !== false);
  const home = items.find(item => item.id === "retailHome");
  if (!home) return null;
  const programming = items.find(item => item.id === "programming");
  return {
    home: { ...home, label: "Retail home" },
    everyday: programming ? [
      { id: "retailEverydayMusic", label: "Music & AutoDJ", href: `${programming.href}#workspace-autodj` },
      { id: "retailEverydayWeek", label: "Weekly planner", href: `${programming.href}#workspace-planner` },
      { id: "retailEverydayCommercials", label: "Commercials", href: `${programming.href}#workspace-commercials` }
    ] : [],
    setup: [
      { id: "locations", label: "Shops & listening areas" },
      { id: "players", label: "Shop devices" }
    ].flatMap(({ id, label }) => {
      const item = items.find(candidate => candidate.id === id);
      return item ? [{ ...item, label }] : [];
    })
  };
}
