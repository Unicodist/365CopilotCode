"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTotal = formatTotal;
function formatTotal(values) {
    return `Total: ${values.reduce((a, b) => a + b, 0)}`;
}
//# sourceMappingURL=util.js.map