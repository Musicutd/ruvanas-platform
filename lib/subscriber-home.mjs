export function buildSubscriberHome({ products = [], onboarding, serviceEnabled = true } = {}) {
  const singleProduct = products.length === 1 ? products[0] : null;
  // The shared first-shop checklist requires a physical location, zone and enrolled player.
  // Online Radio has its own station/AutoDJ/encoder onboarding in its product dashboard.
  const useAudioChecklist = singleProduct?.key === "RETAIL";

  if (useAudioChecklist) {
    return {
      description: `${singleProduct.label}, daily tasks and support in one clear place.`,
      nextAction: onboarding.nextAction,
      onboarding
    };
  }

  if (!serviceEnabled || products.length === 0) {
    return {
      description: "Your Ruvanas services, next steps and support in one clear place.",
      nextAction: {
        eyebrow: "SERVICE ATTENTION",
        title: "Review your service access",
        description: "Check your latest account and service notices before continuing.",
        href: "/dashboard/notifications",
        label: "Review notifications"
      },
      onboarding: null
    };
  }

  if (singleProduct) {
    return {
      description: `${singleProduct.label}, daily tasks and support in one clear place.`,
      nextAction: {
        eyebrow: "START WITH YOUR PRODUCT",
        title: `Open ${singleProduct.label}`,
        description: `Your ${singleProduct.label} dashboard has the setup steps and tools for this service.`,
        href: singleProduct.actionHref,
        label: `Open ${singleProduct.label}`
      },
      onboarding: null
    };
  }

  return {
    description: "Your Ruvanas products, daily tasks and support in one clear place.",
    nextAction: {
      eyebrow: "CHOOSE YOUR PRODUCT",
      title: "What would you like to work on?",
      description: "Choose a product to see the right setup steps and daily tools.",
      href: products[0].actionHref,
      label: `Open ${products[0].label}`
    },
    onboarding: null
  };
}
