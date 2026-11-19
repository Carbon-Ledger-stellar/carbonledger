# How a Credit is Retired

This tutorial walks corporate buyers through retiring a carbon credit on the platform — from picking a project to downloading your retirement certificate. No technical knowledge required.

> **What does "retiring" a credit mean?**
> Retiring a credit permanently takes it out of circulation so it can never be sold or claimed again. Once retired, the credit is "used up" against your company's emissions and you receive a verifiable certificate as proof. Think of it like cancelling a plane ticket: the seat is gone, and you get a receipt confirming it.

---

## Before you start

You'll need:

- A funded Stellar wallet connected to the platform (e.g. **Freighter** browser extension).
- The **project** you want to support, and the **vintage year** of the credits you're retiring.
- The **amount** of credits to retire (1 credit = 1 tonne of CO₂ equivalent).
- A **beneficiary** — the person or company the retirement is attributed to (often your own organisation).
- A short **reason** — e.g. "2024 Scope 1 emissions offset".

---

## Step 1 — Select a project

Open the marketplace and browse or search for a project. Each project card shows its name, location, vintage year, and available credits.

![Step 1: Browsing projects in the marketplace](images/retire-step-1-select-project.png)

Click the project you want to retire credits from. This opens the project detail page.

---

## Step 2 — Open the retirement dialog

On the project detail page, click **Retire credits**. A confirmation dialog opens where you'll enter the details of your retirement.

![Step 2: Opening the retirement dialog](images/retire-step-2-open-dialog.png)

---

## Step 3 — Enter the amount and beneficiary

In the **Retire credits** dialog, fill in the following fields:

| Field | What to enter |
| --- | --- |
| **Amount** | How many credits (tonnes CO₂e) to retire. Must not exceed the credits available. |
| **Beneficiary** | Who the retirement is for — your company name or the person on whose behalf you're retiring. |
| **Project** | Pre-filled from the project you selected. Double-check it's the right one. |
| **Vintage year** | The year the credits were issued. Confirm it matches the credits you intend to retire. |
| **Reason** | A short note explaining why you're retiring, e.g. "Offsetting 2024 business travel". |

![Step 3: Filling in amount, beneficiary, project, vintage, and reason](images/retire-step-3-fill-details.png)

Take a moment to review every field — **retirements are permanent and cannot be undone.**

---

## Step 4 — Confirm with Freighter

When you're happy with the details, click **Confirm retirement**. Your Freighter wallet will pop up asking you to sign the transaction.

![Step 4: Signing the transaction in Freighter](images/retire-step-4-freighter.png)

Review the transaction in Freighter and click **Approve**. The platform submits the retirement to the Stellar network on your behalf.

> **Tip:** If Freighter doesn't appear, make sure the extension is unlocked and connected to the correct network.

---

## Step 5 — Success! Your retirement is complete

Once the transaction is confirmed, you'll see the success screen. It shows:

- The **amount retired**.
- A **certificate preview** containing the project, vintage year, beneficiary, amount, certificate ID, and retirement date.
- Buttons to **download the PDF certificate**, **copy a shareable link**, and **view the transaction on Stellar**.

![Step 5: The retirement success screen with certificate preview](images/retire-step-5-success.png)

From here you can:

- **Download PDF** — save an official, printable copy of your certificate.
- **Copy link** — share a public verification page with auditors, customers, or your sustainability team.
- **View on Stellar** — open the transaction on a public block explorer to independently verify it.

---

## What's on your retirement certificate?

Your certificate is the permanent, verifiable proof of your retirement. It contains:

| Item | What it means |
| --- | --- |
| **Beneficiary** | The person or organisation the retirement is attributed to. |
| **Amount** | The number of credits retired (tonnes CO₂e). |
| **CO₂ equivalent** | The emissions avoided or removed, expressed in tonnes of CO₂e. |
| **Project** | The project that generated the credits. |
| **Vintage** | The year the credits were issued. |
| **Reason** | The note you entered explaining the retirement. |
| **Date** | When the retirement was recorded on the blockchain. |
| **Stellar transaction hash** | The unique ID of the transaction on the Stellar network. |
| **QR code** | A scannable code that links to the public verification page. |

---

## How verification works

Anyone can independently verify your retirement — no account needed.

1. **Scan the QR code** on your certificate, or open the **public URL** printed on it (it looks like `https://<platform>/retire/<id>`). This page shows the retirement details exactly as recorded on-chain.
2. **Check the Stellar transaction.** The certificate includes a link to the transaction on [stellar.expert](https://stellar.expert). This is a public block explorer — anyone can look up the transaction hash and confirm it exists on the Stellar network, when it happened, and that it hasn't been altered.

Because the record lives on a public blockchain, neither you nor the platform can change it after the fact. That's what makes a retirement certificate trustworthy to auditors, customers, and regulators.

---

## Frequently asked questions

**Can I undo a retirement?**
No. Retirements are permanent by design — that's what makes them credible. Double-check the amount, beneficiary, and project before confirming.

**Can I retire on behalf of a client?**
Yes. Put the client's name in the **Beneficiary** field and describe the arrangement in the **Reason** field.

**What if my transaction fails?**
If Freighter shows an error or the transaction doesn't confirm, nothing has been retired. Check your wallet balance and network connection, then try again.

**Where can I find my past certificates?**
Every retirement you make is listed in your account's retirement history, where you can re-download certificates and copy verification links at any time.