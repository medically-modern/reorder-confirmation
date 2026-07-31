// ============================================================
// Shared types for Reorder Confirmation
// ============================================================

// --- Monday Column IDs (from board map) ---
export const MONDAY_COLUMNS = {
  // Identity
  name: "name",
  status: "color_mm2t7tdy",
  subscription: "color_mm273mv8",
  orderType: "color_mm2w6kd",

  // Scheduling
  daysToOrder: "color_mkxmtv9c",
  orderingCycle: "color_mkyjawhq",
  nextOrder: "date_mkp0nvf1",

  // Demographics
  dob: "text_mkvdefh1",
  gender: "color_mm1zgyy2",
  phone: "phone_mkp0q3cw",
  email: "email_mkp01rrw",
  address: "location_mkp0rs0v",

  // Insurance
  primaryInsurance: "color_mm254qxj",
  memberId1: "text_mkvp6zfg",
  secondaryInsurance: "color_mm25cr82",
  memberId2: "text_mm25cpx6",
  insuranceChange: "color_mm2p8v3m",

  // Order Details
  sensorsType: "color_mkxmdscr",
  suppliesType: "color_mkxmnheg",
  infusionSet1: "color_mkxm50f9",
  infQty1: "numeric_mkw839ks",
  infusionSet2: "color_mkxmx5wk",
  infQty2: "numeric_mkwac234",

  // Medical
  cgmCoverage: "color_mm2cmgqe",

  // Files
  mnDocs: "file_mkp0vm0a",

  // --- NEW COLUMNS (to be created on the board) ---
  reorderToken: "text_reorder_token",          // placeholder — update after creating column
  reorderLink: "text_reorder_link",            // placeholder — update after creating column
  patientOrderResponse: "color_patient_order",  // placeholder
  patientResponseTimestamp: "date_patient_ts",  // placeholder
  patientInsuranceResponse: "color_patient_ins", // placeholder
  newInsuranceType: "text_new_ins_type",        // placeholder
  newMemberId: "text_new_member_id",            // placeholder
  patientChangeSummary: "long_text_change_sum",  // placeholder
  insuranceCardFile: "file_ins_card",           // placeholder
} as const;

// --- Subscription types ---
export type SubscriptionType = "Supplies" | "Sensors" | "Sensors & Supplies";

// --- Patient order response ---
export type PatientOrderResponse = "Confirm" | "Delay" | "Cancel";

// --- Patient insurance response ---
export type PatientInsuranceResponse = "Confirmed" | "Changed";

// --- Delay sub-cases ---
export type DelayCase = "indefinitely" | "less_than_20_days" | "20_plus_days";

// --- Insurance options (patient-facing simplified list) ---
export const INSURANCE_OPTIONS = [
  "United",
  "Aetna",
  "Cigna",
  "Anthem BCBS",
  "Medicare",
  "Medicaid",
  "NYSHIP",
  "Fidelis",
  "WellCare",
  "Humana",
  "Other",
] as const;

export type InsuranceOption = (typeof INSURANCE_OPTIONS)[number];

// --- Maps Monday's granular insurance labels → simplified patient-facing name ---
export const INSURANCE_SIMPLIFICATION_MAP: Record<string, InsuranceOption> = {
  "Medicare A&B": "Medicare",
  "Anthem BCBS Commercial": "Anthem BCBS",
  "Cigna": "Cigna",
  "Fidelis Medicaid": "Fidelis",
  "United Medicaid": "United",
  "Medicaid": "Medicaid",
  "Fidelis Low-Cost": "Fidelis",
  "Anthem BCBS Medicaid (JLJ)": "Anthem BCBS",
  "Anthem BCBS Low-Cost (JLJ)": "Anthem BCBS",
  "NYSHIP": "NYSHIP",
  "Horizon BCBS": "Anthem BCBS",
  "United Commercial": "United",
  "Aetna Commercial": "Aetna",
  "Aetna Medicare": "Aetna",
  "Fidelis Commercial": "Fidelis",
  "Wellcare": "WellCare",
  "Anthem BCBS Medicare": "Anthem BCBS",
  "Humana": "Humana",
  "BCBS Wyoming": "Anthem BCBS",
  "Midlands Choice": "Other",
  "Fidelis Medicare": "Fidelis",
  "Magnacare": "Other",
  "United Medicare": "United",
};

// --- Insurance carriers that get 9-unit infusion set max ---
export const HIGH_QUANTITY_INSURERS = [
  "Anthem BCBS Commercial",
  "Cigna",
];

// --- GET response: patient-safe data for the UI ---
export interface ReorderConfirmationData {
  fullName: string;
  subscriptionType: SubscriptionType;
  nextOrderDate: string; // ISO date string
  orderDetails: OrderDetails;
  address: PatientAddress;
  insurance: PatientInsurance;
  dropdownOptions: DropdownOptions;
  maxInfusionQty: number; // 3 or 9 depending on insurance
}

export interface OrderDetails {
  sensorsType: string | null;       // null = not serving
  suppliesType: string | null;      // null = not serving (pump type)
  infusionSet1: string | null;      // null = not serving
  infusionQty1: number | null;
  infusionSet2: string | null;      // null = not serving
  infusionQty2: number | null;
  // cartridge fields TBD — need to confirm with Monday board
}

export interface PatientAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  fullAddress: string; // for display / change summary
}

export interface PatientInsurance {
  simplifiedType: InsuranceOption;
  rawType: string; // original Monday label
  maskedMemberId: string; // e.g., "********1234"
  fullMemberId?: string; // never sent to frontend
}

export interface DropdownOptions {
  sensorTypes: string[];
  infusionSets1: string[];
  infusionSets2: string[];
  suppliesTypes: string[];
  insuranceTypes: typeof INSURANCE_OPTIONS;
}

// --- POST request body ---
export interface ReorderSubmission {
  token: string;
  orderResponse: PatientOrderResponse;

  // Delay-specific
  delayDate?: string;       // ISO date string
  delayIndefinitely?: boolean;

  // Order details (only if completing full flow)
  orderDetails?: {
    sensorsType?: string;
    infusionSet1?: string;
    infusionQty1?: number;
    infusionSet2?: string;
    infusionQty2?: number;
  };

  // Address (only if completing full flow)
  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };

  // Insurance
  insuranceResponse: PatientInsuranceResponse;
  newInsuranceType?: string;
  newInsuranceCustomName?: string; // if "Other" selected
  newMemberId?: string;

  // File uploads handled separately via multipart
}

// --- POST response ---
export interface ReorderSubmissionResult {
  success: boolean;
  message: string;
  errors?: string[];
}

// --- Redis token record ---
export interface TokenRecord {
  mondayItemId: string;
  createdAt: string;       // ISO timestamp
  boardId: string;
  submittedAt?: string;    // set on submission
  orderResponse?: PatientOrderResponse;
}
