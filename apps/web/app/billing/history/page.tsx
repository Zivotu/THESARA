"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/config";
import { auth } from "@/lib/firebase";

interface Invoice {
  id: string;
  amount: number;
  currency: string;
  date: string;
  status: string;
  pdf?: string;
}

export default function BillingHistoryPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const user = auth?.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const res = await fetch(`${API_URL}/billing/transactions`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setInvoices(data.invoices ?? []);
        }
      } catch (err) {
        console.error("load_transactions_failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Purchase History</h1>
      {loading ? (
        <p>Loading...</p>
      ) : invoices.length ? (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1">Date</th>
              <th className="py-1">Amount</th>
              <th className="py-1">Status</th>
              <th className="py-1">Invoice</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b last:border-0">
                <td className="py-1">
                  {new Date(inv.date).toLocaleDateString()}
                </td>
                <td className="py-1">
                  {(inv.amount / 100).toFixed(2)} {inv.currency.toUpperCase()}
                </td>
                <td className="py-1">{inv.status}</td>
                <td className="py-1">
                  {inv.pdf ? (
                    <a
                      href={inv.pdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      PDF
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No purchases</p>
      )}
    </div>
  );
}

