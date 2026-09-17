"use client";

import { DateInput } from "../ui/DateInput";

import { useState } from "react";
import { crmInterestConfig, type CrmInterest } from "../../lib/crm";

export type CrmPurchaseDraft = {
  product: CrmInterest;
  product_detail?: string;
  exness_account?: string;
  tradingview_username?: string;
  subscription_amount?: number;
  subscription_currency?: "EGP" | "USD";
  subscription_starts_on?: string;
  subscription_ends_on?: string;
};

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export function readCrmPurchase(form: FormData): { purchase?: CrmPurchaseDraft; error?: string } {
  const product = text(form, "purchase_product") as CrmInterest;
  if (!(product in crmInterestConfig)) return { error: "اختر المنتج أو الخدمة التي اشتراها العميل." };
  const purchase: CrmPurchaseDraft = { product };
  if (product === "other") {
    const detail = text(form, "purchase_product_detail");
    if (detail.length < 2 || detail.length > 160) return { error: "اكتب اسم المنتج الذي اشتراه العميل." };
    purchase.product_detail = detail;
  }
  if (product === "cashback") {
    const account = text(form, "purchase_exness_account").replace(/\s/g, "").toUpperCase();
    if (!/^[A-Z0-9-]{5,32}$/.test(account)) return { error: "أضف رقم حساب Exness الصحيح للكاش باك." };
    purchase.exness_account = account;
  }
  if (product === "indicator") {
    const username = text(form, "purchase_tradingview_username");
    if (username.length < 3 || username.length > 100) return { error: "أضف اسم مستخدم TradingView للمؤشر." };
    purchase.tradingview_username = username;
  }
  if (form.get("purchase_subscription") === "on") {
    const amount = Number(text(form, "purchase_subscription_amount"));
    const currency = text(form, "purchase_subscription_currency") as "EGP" | "USD";
    const starts = text(form, "purchase_subscription_starts_on");
    const ends = text(form, "purchase_subscription_ends_on");
    if (!Number.isFinite(amount) || amount <= 0 || !["EGP", "USD"].includes(currency) || !starts || !ends || ends < starts) {
      return { error: "أكمل قيمة الاشتراك وعملته وتاريخ بدايته ونهايته." };
    }
    Object.assign(purchase, { subscription_amount: amount, subscription_currency: currency, subscription_starts_on: starts, subscription_ends_on: ends });
  }
  return { purchase };
}

export function CrmPurchaseFields({ defaultProduct }: { defaultProduct: CrmInterest }) {
  const [product, setProduct] = useState<CrmInterest>(defaultProduct);
  const [subscription, setSubscription] = useState(false);
  return <fieldset className="crm-purchase-fields">
    <legend>المنتج الذي اشتراه بالفعل</legend>
    <label><span>المنتج أو الخدمة</span><select name="purchase_product" value={product} onChange={(event) => setProduct(event.target.value as CrmInterest)} required>{(Object.keys(crmInterestConfig) as CrmInterest[]).map((value) => <option value={value} key={value}>{crmInterestConfig[value].label}</option>)}</select></label>
    {product === "other" ? <label><span>اسم المنتج</span><input name="purchase_product_detail" required minLength={2} maxLength={160} /></label> : null}
    {product === "cashback" ? <label><span>رقم حساب Exness</span><input name="purchase_exness_account" dir="ltr" required minLength={5} maxLength={32} placeholder="Account number" /></label> : null}
    {product === "indicator" ? <label><span>اسم مستخدم TradingView</span><input name="purchase_tradingview_username" dir="ltr" required minLength={3} maxLength={100} placeholder="TradingView username" /></label> : null}
    <label className="crm-checkbox"><input name="purchase_subscription" type="checkbox" checked={subscription} onChange={(event) => setSubscription(event.target.checked)} /><span>المنتج اشتراك بمدة محددة</span></label>
    {subscription ? <div className="crm-purchase-subscription">
      <label><span>قيمة الاشتراك</span><input name="purchase_subscription_amount" type="number" min="0.01" step="0.01" required /></label>
      <label><span>العملة</span><select name="purchase_subscription_currency" defaultValue="EGP"><option value="EGP">EGP</option><option value="USD">USD</option></select></label>
      <label><span>بداية الاشتراك</span><DateInput name="purchase_subscription_starts_on" type="date" required /></label>
      <label><span>نهاية الاشتراك</span><DateInput name="purchase_subscription_ends_on" type="date" required /></label>
    </div> : null}
  </fieldset>;
}
