"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  ReorderConfirmationData,
  PatientOrderResponse,
  PatientInsuranceResponse,
  ReorderSubmission,
  INSURANCE_OPTIONS,
} from "@/lib/types";

// ============================================================
// Patient Reorder Confirmation Page
// ============================================================

type FlowStep = "loading" | "error" | "already_submitted" | "decision" | "form" | "submitting" | "success";

export default function ReorderConfirmationPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [step, setStep] = useState<FlowStep>("loading");
  const [data, setData] = useState<ReorderConfirmationData | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // --- Decision state ---
  const [orderResponse, setOrderResponse] = useState<PatientOrderResponse | null>(null);
  const [delayDate, setDelayDate] = useState("");
  const [delayIndefinitely, setDelayIndefinitely] = useState(false);
  const [showDelayWarning, setShowDelayWarning] = useState(false);
  const [delayDateError, setDelayDateError] = useState("");

  // --- Order details state ---
  const [sensorsType, setSensorsType] = useState("");
  const [infusionSet1, setInfusionSet1] = useState("");
  const [infusionQty1, setInfusionQty1] = useState(0);
  const [infusionSet2, setInfusionSet2] = useState("");
  const [infusionQty2, setInfusionQty2] = useState(0);

  // --- Address state ---
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [zipError, setZipError] = useState("");

  // --- Insurance state ---
  const [insuranceResponse, setInsuranceResponse] = useState<PatientInsuranceResponse>("Confirmed");
  const [newInsuranceType, setNewInsuranceType] = useState("");
  const [newInsuranceCustom, setNewInsuranceCustom] = useState("");
  const [newMemberId, setNewMemberId] = useState("");
  const [insuranceFront, setInsuranceFront] = useState<File | null>(null);
  const [insuranceBack, setInsuranceBack] = useState<File | null>(null);

  // --- Computed: should the patient complete the full flow? ---
  const requiresFullFlow = useCallback(() => {
    if (orderResponse === "Confirm") return true;
    if (orderResponse === "Cancel") return false;
    if (orderResponse === "Delay") {
      if (delayIndefinitely) return false;
      if (delayDate) {
        const days = daysBetween(new Date(), new Date(delayDate));
        return days < 20;
      }
    }
    return false;
  }, [orderResponse, delayIndefinitely, delayDate]);

  const canSkipFlow = useCallback(() => {
    if (orderResponse === "Delay" && !delayIndefinitely && delayDate) {
      const days = daysBetween(new Date(), new Date(delayDate));
      return days >= 20;
    }
    return false;
  }, [orderResponse, delayIndefinitely, delayDate]);

  // --- Load data ---
  useEffect(() => {
    if (!token) {
      setErrorMessage("No confirmation link found. Please use the link from your text message.");
      setStep("error");
      return;
    }

    fetch(`/api/reorder-confirmation?token=${token}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          if (json.error === "already_submitted") {
            setSuccessMessage(json.message);
            setStep("already_submitted");
          } else {
            setErrorMessage(json.error || "Something went wrong");
            setStep("error");
          }
          return;
        }
        setData(json as ReorderConfirmationData);
        // Pre-fill form fields
        prefillForm(json as ReorderConfirmationData);
        setStep("decision");
      })
      .catch(() => {
        setErrorMessage("Unable to load your order details. Please try again.");
        setStep("error");
      });
  }, [token]);

  // --- Pre-fill form with current data ---
  function prefillForm(d: ReorderConfirmationData) {
    if (d.orderDetails.sensorsType) setSensorsType(d.orderDetails.sensorsType);
    if (d.orderDetails.infusionSet1) setInfusionSet1(d.orderDetails.infusionSet1);
    if (d.orderDetails.infusionQty1 != null) setInfusionQty1(d.orderDetails.infusionQty1);
    if (d.orderDetails.infusionSet2) setInfusionSet2(d.orderDetails.infusionSet2);
    if (d.orderDetails.infusionQty2 != null) setInfusionQty2(d.orderDetails.infusionQty2);
    setStreet(d.address.street);
    setCity(d.address.city);
    setState(d.address.state);
    setZip(d.address.zip);
  }

  // --- Handle decision selection ---
  function handleDecision(response: PatientOrderResponse) {
    setOrderResponse(response);

    if (response === "Confirm") {
      setStep("form");
    }
    // Delay and Cancel show sub-flows inline before moving to form
  }

  // --- Handle delay date change ---
  function handleDelayDateChange(dateStr: string) {
    setDelayDate(dateStr);
    setDelayDateError("");
    setShowDelayWarning(false);

    if (!dateStr || !data) return;

    const selected = new Date(dateStr);
    const currentOrder = new Date(data.nextOrderDate);

    // Cannot move earlier
    if (selected < currentOrder) {
      setDelayDateError(
        "Sorry, this is the earliest insurance will cover your reorder. Please text/call us if there is an extraordinary situation where your order date needs to be pushed up."
      );
      return;
    }

    // Less than 20 days warning
    const daysFromNow = daysBetween(new Date(), selected);
    if (daysFromNow < 20) {
      setShowDelayWarning(true);
    }
  }

  // --- Proceed from delay/cancel to form ---
  function proceedToForm() {
    setStep("form");
  }

  // --- Submit ---
  async function handleSubmit(skipRemainingFlow = false) {
    if (!token || !orderResponse) return;

    // Validate zip if address is being submitted
    if (!skipRemainingFlow && zip && !/^\d{5}$/.test(zip)) {
      setZipError("ZIP code must be exactly 5 digits");
      return;
    }

    setStep("submitting");

    const submission: ReorderSubmission = {
      token,
      orderResponse,
      insuranceResponse,
      delayDate: delayDate || undefined,
      delayIndefinitely: delayIndefinitely || undefined,
      orderDetails: !skipRemainingFlow && (requiresFullFlow() || !skipRemainingFlow)
        ? {
            sensorsType: data?.orderDetails.sensorsType ? sensorsType : undefined,
            infusionSet1: data?.orderDetails.infusionSet1 ? infusionSet1 : undefined,
            infusionQty1: data?.orderDetails.infusionSet1 ? infusionQty1 : undefined,
            infusionSet2: data?.orderDetails.infusionSet2 ? infusionSet2 : undefined,
            infusionQty2: data?.orderDetails.infusionSet2 ? infusionQty2 : undefined,
          }
        : undefined,
      address: !skipRemainingFlow
        ? { street, city, state, zip }
        : undefined,
      newInsuranceType:
        insuranceResponse === "Changed"
          ? newInsuranceType === "Other"
            ? newInsuranceCustom
            : newInsuranceType
          : undefined,
      newMemberId: insuranceResponse === "Changed" ? newMemberId : undefined,
    };

    try {
      // Use FormData if files are attached
      let res: Response;
      if (insuranceFront || insuranceBack) {
        const formData = new FormData();
        formData.append("data", JSON.stringify(submission));
        if (insuranceFront) formData.append("insuranceFront", insuranceFront);
        if (insuranceBack) formData.append("insuranceBack", insuranceBack);
        res = await fetch(`/api/reorder-confirmation?token=${token}`, {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch(`/api/reorder-confirmation?token=${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submission),
        });
      }

      const result = await res.json();
      if (result.success) {
        setSuccessMessage(result.message);
        setStep("success");
      } else {
        setErrorMessage(result.errors?.join(", ") || result.error || "Submission failed");
        setStep("form");
      }
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
      setStep("form");
    }
  }

  // ========================
  // RENDER
  // ========================

  if (step === "loading") {
    return (
      <PageShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-gray-500">Loading your order details...</p>
          </div>
        </div>
      </PageShell>
    );
  }

  if (step === "error") {
    return (
      <PageShell>
        <div className="text-center py-12">
          <div className="text-red-500 text-5xl mb-4">!</div>
          <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
          <p className="text-gray-600">{errorMessage}</p>
          <p className="text-gray-500 mt-4 text-sm">
            If you continue having issues, please text or call us.
          </p>
        </div>
      </PageShell>
    );
  }

  if (step === "already_submitted" || step === "success") {
    return (
      <PageShell>
        <div className="text-center py-12">
          <div className="text-green-500 text-5xl mb-4">&#10003;</div>
          <h2 className="text-xl font-semibold mb-2">
            {step === "already_submitted" ? "Already Submitted" : "Submitted!"}
          </h2>
          <p className="text-gray-600">{successMessage}</p>
        </div>
        <Footer />
      </PageShell>
    );
  }

  if (step === "submitting") {
    return (
      <PageShell>
        <Header data={data!} />
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-gray-500">Submitting your response...</p>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Header data={data!} />

      {/* ===== SECTION 1: DECISION ===== */}
      {step === "decision" && (
        <Section title="Do you want to receive your next order?">
          <div className="space-y-3">
            <BigButton
              label="Confirm"
              sublabel="Yes, process my order"
              selected={orderResponse === "Confirm"}
              onClick={() => handleDecision("Confirm")}
              variant="green"
            />
            <BigButton
              label="Delay"
              sublabel="Move my order to a later date"
              selected={orderResponse === "Delay"}
              onClick={() => handleDecision("Delay")}
              variant="yellow"
            />
            <BigButton
              label="Cancel"
              sublabel="Cancel all ongoing orders"
              selected={orderResponse === "Cancel"}
              onClick={() => handleDecision("Cancel")}
              variant="red"
            />
          </div>

          {/* --- Delay sub-flow --- */}
          {orderResponse === "Delay" && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg space-y-4">
              <p className="font-medium">What date should we move your next order to?</p>
              <p className="text-sm text-gray-500">
                You&apos;ll receive a new confirmation text 20 days before that order.
              </p>

              <input
                type="date"
                value={delayDate}
                onChange={(e) => handleDelayDateChange(e.target.value)}
                className="w-full p-3 border rounded-lg text-base"
                min={data?.nextOrderDate}
              />

              {delayDateError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {delayDateError}
                </div>
              )}

              {showDelayWarning && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
                  Because this date is less than 20 days from today, this will act as confirming your
                  order and you will not receive another confirmation text.
                </div>
              )}

              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="indefinitely"
                  checked={delayIndefinitely}
                  onChange={(e) => {
                    setDelayIndefinitely(e.target.checked);
                    if (e.target.checked) {
                      setDelayDate("");
                      setDelayDateError("");
                    }
                  }}
                  className="h-5 w-5"
                />
                <label htmlFor="indefinitely" className="text-base">
                  Delay indefinitely
                </label>
              </div>

              {delayIndefinitely && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">
                  Because you did not select a new order date, we will not be following up with a new
                  confirmation text. You will need to reach out to us when you are ready to place
                  your next order.
                </div>
              )}

              {(delayDate || delayIndefinitely) && !delayDateError && (
                <button
                  onClick={() => {
                    if (delayIndefinitely) {
                      handleSubmit(true);
                    } else {
                      proceedToForm();
                    }
                  }}
                  className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium text-base"
                >
                  {delayIndefinitely
                    ? "Submit"
                    : canSkipFlow()
                    ? "Continue (or skip to submit)"
                    : "Continue"}
                </button>
              )}

              {canSkipFlow() && delayDate && !delayDateError && (
                <button
                  onClick={() => handleSubmit(true)}
                  className="w-full py-3 border border-gray-300 text-gray-600 rounded-lg font-medium text-base"
                >
                  Skip &amp; Submit with New Date Only
                </button>
              )}
            </div>
          )}

          {/* --- Cancel sub-flow --- */}
          {orderResponse === "Cancel" && (
            <div className="mt-6 p-4 bg-red-50 rounded-lg space-y-4">
              <p className="font-medium text-red-800">
                This will cancel all ongoing orders.
              </p>
              <button
                onClick={() => handleSubmit(true)}
                className="w-full py-3 bg-red-600 text-white rounded-lg font-medium text-base"
              >
                Confirm Cancellation
              </button>
            </div>
          )}
        </Section>
      )}

      {/* ===== FORM SECTIONS (Confirm / Delay <20 days / Delay 20+ continuing) ===== */}
      {step === "form" && data && (
        <>
          {/* Section 2: Order Details */}
          <Section title="Order Details">
            <p className="text-sm text-gray-500 mb-4">
              Review and update your current order. Changes will be saved automatically.
            </p>

            {data.orderDetails.sensorsType && (
              <FormField label="CGM / Sensor Type">
                <select
                  value={sensorsType}
                  onChange={(e) => setSensorsType(e.target.value)}
                  className="w-full p-3 border rounded-lg text-base bg-white"
                >
                  {data.dropdownOptions.sensorTypes.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </FormField>
            )}

            {data.orderDetails.infusionSet1 && (
              <>
                <FormField label="Infusion Set 1">
                  <select
                    value={infusionSet1}
                    onChange={(e) => setInfusionSet1(e.target.value)}
                    className="w-full p-3 border rounded-lg text-base bg-white"
                  >
                    {data.dropdownOptions.infusionSets.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Quantity">
                  <input
                    type="number"
                    value={infusionQty1}
                    onChange={(e) => setInfusionQty1(Number(e.target.value))}
                    min={0}
                    max={data.maxInfusionQty}
                    className="w-full p-3 border rounded-lg text-base"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Max {data.maxInfusionQty} total units across infusion sets. If you don&apos;t want a
                    certain item, set the quantity to 0.
                  </p>
                </FormField>
              </>
            )}

            {data.orderDetails.infusionSet2 && (
              <>
                <FormField label="Infusion Set 2">
                  <select
                    value={infusionSet2}
                    onChange={(e) => setInfusionSet2(e.target.value)}
                    className="w-full p-3 border rounded-lg text-base bg-white"
                  >
                    {data.dropdownOptions.infusionSets.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Quantity">
                  <input
                    type="number"
                    value={infusionQty2}
                    onChange={(e) => setInfusionQty2(Number(e.target.value))}
                    min={0}
                    max={data.maxInfusionQty}
                    className="w-full p-3 border rounded-lg text-base"
                  />
                </FormField>
              </>
            )}
          </Section>

          {/* Section 3: Address */}
          <Section title="Shipping Address">
            <FormField label="Street Address">
              <input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                className="w-full p-3 border rounded-lg text-base"
              />
            </FormField>
            <FormField label="City">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full p-3 border rounded-lg text-base"
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="State">
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  maxLength={2}
                  className="w-full p-3 border rounded-lg text-base uppercase"
                />
              </FormField>
              <FormField label="ZIP Code">
                <input
                  type="text"
                  value={zip}
                  onChange={(e) => {
                    setZip(e.target.value);
                    setZipError("");
                  }}
                  maxLength={5}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className={`w-full p-3 border rounded-lg text-base ${
                    zipError ? "border-red-500" : ""
                  }`}
                />
                {zipError && (
                  <p className="text-red-500 text-xs mt-1">{zipError}</p>
                )}
              </FormField>
            </div>
          </Section>

          {/* Section 4: Insurance */}
          <Section title="Insurance">
            <div className="p-3 bg-gray-50 rounded-lg mb-4">
              <p className="text-sm text-gray-600">
                Current insurance: <strong>{data.insurance.simplifiedType}</strong>
              </p>
              <p className="text-sm text-gray-600">
                Member ID: <strong>{data.insurance.maskedMemberId}</strong>
              </p>
            </div>

            <p className="font-medium mb-3">
              Will your insurance change before your order date?
            </p>

            <div className="space-y-2 mb-4">
              <label className="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer">
                <input
                  type="radio"
                  name="insurance"
                  checked={insuranceResponse === "Confirmed"}
                  onChange={() => setInsuranceResponse("Confirmed")}
                  className="h-5 w-5"
                />
                <span>No</span>
              </label>
              <label className="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer">
                <input
                  type="radio"
                  name="insurance"
                  checked={insuranceResponse === "Changed"}
                  onChange={() => setInsuranceResponse("Changed")}
                  className="h-5 w-5"
                />
                <span>Yes</span>
              </label>
            </div>

            {insuranceResponse === "Changed" && (
              <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                <FormField label="New Insurance Type">
                  <select
                    value={newInsuranceType}
                    onChange={(e) => setNewInsuranceType(e.target.value)}
                    className="w-full p-3 border rounded-lg text-base bg-white"
                  >
                    <option value="">Select insurance...</option>
                    {INSURANCE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </FormField>

                {newInsuranceType === "Other" && (
                  <FormField label="Insurance Name">
                    <input
                      type="text"
                      value={newInsuranceCustom}
                      onChange={(e) => setNewInsuranceCustom(e.target.value)}
                      placeholder="Enter your insurance name"
                      className="w-full p-3 border rounded-lg text-base"
                    />
                  </FormField>
                )}

                <FormField label="New Member ID">
                  <input
                    type="text"
                    value={newMemberId}
                    onChange={(e) => setNewMemberId(e.target.value)}
                    placeholder="Enter your new member ID"
                    className="w-full p-3 border rounded-lg text-base"
                  />
                </FormField>

                <div>
                  <p className="text-sm font-medium mb-2">Insurance Card (optional)</p>
                  <p className="text-xs text-gray-500 mb-3">
                    Uploading your insurance card helps us verify your coverage faster.
                  </p>
                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-sm text-gray-600">Front of card</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => setInsuranceFront(e.target.files?.[0] || null)}
                        className="block w-full mt-1 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm text-gray-600">Back of card</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => setInsuranceBack(e.target.files?.[0] || null)}
                        className="block w-full mt-1 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* Submit button */}
          {errorMessage && (
            <div className="mx-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">
              {errorMessage}
            </div>
          )}

          <div className="px-4 pb-8">
            <button
              onClick={() => handleSubmit(false)}
              className="w-full py-4 bg-blue-600 text-white rounded-lg font-semibold text-lg"
            >
              Submit
            </button>
          </div>

          <Footer />
        </>
      )}

      {step === "decision" && <Footer />}
    </PageShell>
  );
}

// ============================================================
// Sub-components
// ============================================================

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-lg mx-auto">{children}</div>
    </div>
  );
}

function Header({ data }: { data: ReorderConfirmationData }) {
  const formattedDate = data.nextOrderDate
    ? new Date(data.nextOrderDate + "T00:00:00").toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "TBD";

  return (
    <div className="bg-blue-600 text-white px-4 py-6">
      <h1 className="text-2xl font-bold">{data.fullName}</h1>
      <p className="text-blue-100 mt-1">
        Subscription: {data.subscriptionType}
      </p>
      <p className="text-blue-100">
        Your next order is scheduled for <strong>{formattedDate}</strong>
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-6 border-b border-gray-100">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function BigButton({
  label,
  sublabel,
  selected,
  onClick,
  variant,
}: {
  label: string;
  sublabel: string;
  selected: boolean;
  onClick: () => void;
  variant: "green" | "yellow" | "red";
}) {
  const colors = {
    green: selected
      ? "border-green-500 bg-green-50"
      : "border-gray-200 hover:border-green-300",
    yellow: selected
      ? "border-yellow-500 bg-yellow-50"
      : "border-gray-200 hover:border-yellow-300",
    red: selected
      ? "border-red-500 bg-red-50"
      : "border-gray-200 hover:border-red-300",
  };

  return (
    <button
      onClick={onClick}
      className={`w-full p-4 border-2 rounded-lg text-left transition-colors ${colors[variant]}`}
    >
      <p className="font-semibold text-base">{label}</p>
      <p className="text-sm text-gray-500">{sublabel}</p>
    </button>
  );
}

function Footer() {
  return (
    <div className="px-4 py-6 text-center text-sm text-gray-400">
      If you had any issues with this form, please text/call us.
    </div>
  );
}

// --- Utility ---
function daysBetween(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((b.getTime() - a.getTime()) / msPerDay);
}
