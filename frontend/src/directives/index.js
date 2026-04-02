import { requiredDot } from "./requiredDot";
import { permissionDirective } from "./permission";

export default {
  install(app) {
    app.directive("required-dot", requiredDot);
    app.directive("permission", permissionDirective);
  },
};