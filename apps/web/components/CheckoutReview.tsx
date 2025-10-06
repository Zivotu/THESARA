'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

// Original BillingPackage type is kept for convenience when mapping API
// responses to checkout items in the page component.
export type BillingPackage = {
  id: string;
  name: string;
  description?: string;
  priceId: string;
  price?: number;
  currency?: string;
};

export type CheckoutItem = {
  name: string;
  description?: string;
  price: number; // price in cents
  currency?: string;
};

type AddressInfo = {
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  vatId?: string;
};

interface Props {
  item: CheckoutItem;
  email?: string;
  addressInfo?: AddressInfo;
  tax?: number;
  discount?: number;
  onProceed: (email: string, address: AddressInfo) => Promise<void> | void;
  loading?: boolean;
  error?: string | null;
}

export default function CheckoutReview({
  item,
  email,
  addressInfo,
  tax = 0,
  discount = 0,
  onProceed,
  loading = false,
  error,
}: Props) {
  const [customerEmail, setCustomerEmail] = useState(email || '');
  const [customerAddress, setCustomerAddress] = useState(addressInfo?.address || '');
  const [customerCity, setCustomerCity] = useState(addressInfo?.city || '');
  const [customerPostalCode, setCustomerPostalCode] = useState(
    addressInfo?.postalCode || '',
  );
  const [customerCountry, setCustomerCountry] = useState(
    addressInfo?.country || '',
  );
  const [customerVatId, setCustomerVatId] = useState(addressInfo?.vatId || '');

  useEffect(() => {
    if (email) setCustomerEmail(email);
  }, [email]);

  useEffect(() => {
    if (addressInfo) {
      if (addressInfo.address) setCustomerAddress(addressInfo.address);
      if (addressInfo.city) setCustomerCity(addressInfo.city);
      if (addressInfo.postalCode) setCustomerPostalCode(addressInfo.postalCode);
      if (addressInfo.country) setCustomerCountry(addressInfo.country);
      if (addressInfo.vatId) setCustomerVatId(addressInfo.vatId);
    }
  }, [addressInfo]);

  const fmt =
    item.currency != null
      ? new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: item.currency,
        })
      : null;

  const basePrice = fmt ? fmt.format(item.price / 100) : null;
  const taxAmount = fmt ? fmt.format(tax / 100) : null;
  const discountAmount = fmt ? fmt.format(discount / 100) : null;
  const totalAmount = fmt
    ? fmt.format((item.price + tax - discount) / 100)
    : null;

  const handle = async () => {
    await onProceed(customerEmail, {
      address: customerAddress,
      city: customerCity,
      postalCode: customerPostalCode,
      country: customerCountry,
      vatId: customerVatId,
    });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-center">Pregled narudžbe</h1>

      <Card className="p-4 space-y-2">
          <div className="flex justify-between">
            <span className="font-semibold">Pretplata</span>
            <span>{item.name}</span>
          </div>
          {basePrice && (
            <div className="flex justify-between">
              <span className="font-semibold">Cijena</span>
              <span>{basePrice}</span>
            </div>
          )}
          {tax > 0 && taxAmount && (
            <div className="flex justify-between">
              <span className="font-semibold">Porez</span>
              <span>{taxAmount}</span>
            </div>
          )}
          {discount > 0 && discountAmount && (
            <div className="flex justify-between">
              <span className="font-semibold">Popust</span>
              <span>-{discountAmount}</span>
            </div>
          )}
          {totalAmount && (
            <div className="flex justify-between border-t pt-2 mt-2">
              <span className="font-semibold">Ukupno</span>
              <span>{totalAmount}</span>
            </div>
          )}
        </Card>

      <Card className="p-4 space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email za račun
          </label>
          <Input
            id="email"
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
          />
        </Card>

      <Card className="p-4 space-y-2">
          <label htmlFor="address" className="text-sm font-medium">
            Adresa
          </label>
          <Input
            id="address"
            type="text"
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
          />
          <div className="flex gap-2">
            <Input
              id="city"
              type="text"
              value={customerCity}
              onChange={(e) => setCustomerCity(e.target.value)}
              placeholder="Grad"
            />
            <Input
              id="postalCode"
              type="text"
              value={customerPostalCode}
              onChange={(e) => setCustomerPostalCode(e.target.value)}
              placeholder="Poštanski broj"
            />
          </div>
          <Input
            id="country"
            type="text"
            value={customerCountry}
            onChange={(e) => setCustomerCountry(e.target.value)}
            placeholder="Država"
          />
          <Input
            id="vatId"
            type="text"
            value={customerVatId}
            onChange={(e) => setCustomerVatId(e.target.value)}
            placeholder="OIB/VAT ID"
          />
      </Card>

      <Button onClick={handle} disabled={loading} className="w-full">
        {loading ? 'Slanje…' : 'Nastavi'}
      </Button>
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}

