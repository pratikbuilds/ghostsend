"use client";

import { use } from "react";
import { PaymentLinkSender } from "@/components/payment-link-sender";
import { Header } from "@/components/header";

export default function PaymentPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = use(params);

   return (
     <div className="min-h-screen dot-pattern">
       <Header />
       <main className="container mx-auto px-4 py-8">
         <div className="max-w-2xl mx-auto space-y-6">
           {/* Hero section */}
           <div className="text-center space-y-2">
             <h1 className="text-4xl font-bold tracking-tight gradient-text">
               ghostsend Payment
             </h1>
             <p className="text-muted-foreground">
               You've received a private payment request. Complete the payment below.
             </p>
           </div>

           {/* Payment component */}
           <PaymentLinkSender paymentId={paymentId} />

           {/* Info section */}
           <div className="mt-8 p-6 bg-muted/30 rounded-lg border gradient-border">
             <h3 className="font-semibold mb-3 gradient-text">How ghostsend Works</h3>
             <ul className="space-y-2 text-sm text-muted-foreground">
               <li className="flex gap-2">
                 <span className="text-[oklch(0.72_0.15_220)]">•</span>
                 <span>Your payment is processed through ghostsend, ensuring transaction privacy</span>
               </li>
               <li className="flex gap-2">
                 <span className="text-[oklch(0.72_0.15_220)]">•</span>
                 <span>The recipient's wallet address is never exposed publicly</span>
               </li>
               <li className="flex gap-2">
                 <span className="text-[oklch(0.72_0.15_220)]">•</span>
                 <span>Zero-knowledge proofs protect your financial privacy</span>
               </li>
               <li className="flex gap-2">
                 <span className="text-[oklch(0.72_0.15_220)]">•</span>
                 <span>All transactions are secured by the Solana blockchain</span>
               </li>
             </ul>
           </div>
         </div>
       </main>
     </div>
  );
}
