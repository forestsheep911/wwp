import { transportUrl } from "./notion-attachment-transport.mjs";
export const { nextMonthlyReset, analyzeTrafficSample, createVpnTrafficMonitor } = await import(transportUrl("lib/vpn-traffic-monitor.mjs"));
