"use client";

import { use } from "react";
import { PaymentReceiver } from "@/components/payment-receiver";
import { Header } from "@/components/header";

export default function PaymentPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = use(params);

   return (
      <div className="min-h-screen w-full relative bg-black">
        {/* Prismatic Aurora Burst - Multi-layered Gradient */}
        <div
          className="absolute inset-0 z-0"
          style={{
            background: `
              radial-gradient(ellipse 120% 80% at 70% 20%, rgba(255, 20, 147, 0.15), transparent 50%),
              radial-gradient(ellipse 100% 60% at 30% 10%, rgba(0, 255, 255, 0.12), transparent 60%),
              radial-gradient(ellipse 90% 70% at 50% 0%, rgba(138, 43, 226, 0.18), transparent 65%),
              radial-gradient(ellipse 110% 50% at 80% 30%, rgba(255, 215, 0, 0.08), transparent 40%),
              #000000
            `,
          }}
        />
        <Header />
        <main className="relative z-20 container mx-auto px-4 py-8">
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
           <PaymentReceiver paymentId={paymentId} />

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
