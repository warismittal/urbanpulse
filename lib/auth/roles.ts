/**
 * Stakeholders of the smart-city platform and what each one may open.
 *
 * Access is enforced in the browser for this demo (there is no backend); the
 * same table would back route guards and API scopes on a server.
 */
export type Role = "commissioner" | "traffic" | "emergency" | "environment" | "health" | "citizen";

export type Area = "city3d" | "dashboard" | "traffic" | "emergency" | "surveillance" | "environment" | "citizen";

export interface RoleInfo {
  id: Role;
  label: string;
  department: string;
  blurb: string;
  home: string;
  areas: Area[];
  /** Panels of the 3D city this role sees. */
  modes: ("overview" | "traffic" | "emergency" | "surveillance" | "environment" | "citizen")[];
  demo: { name: string; email: string; password: string };
}

export const ROLES: RoleInfo[] = [
  {
    id: "commissioner",
    label: "City Commissioner",
    department: "Integrated Command & Control Centre",
    blurb: "Everything: live city, all dashboards, scenarios and broadcasts.",
    home: "/",
    areas: ["city3d", "dashboard", "traffic", "emergency", "surveillance", "environment", "citizen"],
    modes: ["overview", "traffic", "emergency", "surveillance", "environment", "citizen"],
    demo: { name: "Anita Rao", email: "commissioner@urbanpulse.gov.in", password: "demo1234" },
  },
  {
    id: "traffic",
    label: "Traffic Police",
    department: "Traffic Management Centre",
    blurb: "Signals, congestion, forecasts, CCTV and ANPR, green waves.",
    home: "/traffic",
    areas: ["city3d", "dashboard", "traffic", "surveillance"],
    modes: ["overview", "traffic", "surveillance"],
    demo: { name: "Insp. Harpreet Singh", email: "traffic@urbanpulse.gov.in", password: "demo1234" },
  },
  {
    id: "emergency",
    label: "Emergency Operations",
    department: "Fire, Disaster & Rescue",
    blurb: "Incident scenarios, dispatch, evacuation and citizen alerts.",
    home: "/emergency",
    areas: ["city3d", "dashboard", "emergency", "traffic", "surveillance"],
    modes: ["overview", "emergency", "traffic", "surveillance"],
    demo: { name: "DFO Meera Iyer", email: "eoc@urbanpulse.gov.in", password: "demo1234" },
  },
  {
    id: "environment",
    label: "Environment Officer",
    department: "Pollution Control Board",
    blurb: "AQI, PM2.5/PM10, sources, noise, heat, green cover, ML forecast.",
    home: "/environment",
    areas: ["city3d", "dashboard", "environment"],
    modes: ["overview", "environment"],
    demo: { name: "Dr. Kabir Sethi", email: "pcb@urbanpulse.gov.in", password: "demo1234" },
  },
  {
    id: "health",
    label: "Hospital & Ambulance",
    department: "Civil Hospital · 108 control",
    blurb: "Ambulance dispatch with signal priority, incidents and air quality.",
    home: "/emergency",
    areas: ["city3d", "emergency", "environment"],
    modes: ["overview", "emergency", "traffic", "environment"],
    demo: { name: "Dr. Neha Kapoor", email: "hospital@urbanpulse.gov.in", password: "demo1234" },
  },
  {
    id: "citizen",
    label: "Citizen",
    department: "Resident",
    blurb: "Report problems, track complaints, traffic, air, services, alerts.",
    home: "/citizen",
    areas: ["city3d", "citizen"],
    modes: ["overview", "citizen", "environment"],
    demo: { name: "Rohan Mehta", email: "citizen@urbanpulse.in", password: "demo1234" },
  },
];

export const roleInfo = (r: Role) => ROLES.find((x) => x.id === r)!;

/** Which area a route belongs to. */
export function areaOf(path: string): Area | null {
  if (path === "/") return "city3d";
  const seg = path.split("/")[1];
  const map: Record<string, Area> = {
    overview: "dashboard",
    traffic: "traffic",
    emergency: "emergency",
    surveillance: "surveillance",
    environment: "environment",
    citizen: "citizen",
  };
  return map[seg] ?? null;
}

export function canOpen(role: Role, path: string) {
  const a = areaOf(path);
  return a === null || roleInfo(role).areas.includes(a);
}
