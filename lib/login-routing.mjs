import { enabledSubscriberProducts } from "./product-access.mjs";
import { isPlatformAdminRole } from "./permissions.mjs";

export const LOGIN_LANDING_ROUTES = Object.freeze({
  STUDENT: "/school-student",
  PLATFORM_ADMIN: "/admin/stations",
  PRODUCT_CHOOSER: "/dashboard",
  SERVICE_ACTIVATION: "/dashboard/account?reason=service-activation",
  REGISTRATION: "/register"
});

export function loginLandingRoute({ role, hasMembership = false, entitlements = {} } = {}) {
  if (role === "STUDENT") return LOGIN_LANDING_ROUTES.STUDENT;
  if (isPlatformAdminRole(role)) return LOGIN_LANDING_ROUTES.PLATFORM_ADMIN;
  if (!hasMembership) return LOGIN_LANDING_ROUTES.REGISTRATION;

  const products = enabledSubscriberProducts(entitlements);
  if (products.length === 1) return products[0].href;
  if (products.length > 1) return LOGIN_LANDING_ROUTES.PRODUCT_CHOOSER;
  return LOGIN_LANDING_ROUTES.SERVICE_ACTIVATION;
}
