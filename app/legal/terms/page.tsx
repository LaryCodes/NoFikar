import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-6 py-12">
        <Link href="/app/settings">
          <Button variant="ghost" size="sm" className="mb-6 gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>

        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6 text-sm">
          <section>
            <h2 className="text-xl font-semibold mb-3">Acceptance of Terms</h2>
            <p className="text-muted-foreground">
              By accessing and using NoFikar, you accept and agree to be bound by these Terms of Service. If you do not agree, please do not use our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Service Description</h2>
            <p className="text-muted-foreground">
              NoFikar is a consent-based family safety platform that enables real-time location sharing, safe zones, and emergency features among family members.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">User Responsibilities</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>You must be 13 years or older to create an account</li>
              <li>You are responsible for maintaining account security</li>
              <li>You must provide accurate information</li>
              <li>You must not use the service for illegal purposes</li>
              <li>You must not attempt to access other users' accounts</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Consent & Privacy</h2>
            <p className="text-muted-foreground mb-2">
              NoFikar is designed around explicit consent:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Location sharing must be voluntarily enabled</li>
              <li>Users can disable sharing at any time</li>
              <li>Emergency features require approval</li>
              <li>Users can leave family circles freely</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Prohibited Use</h2>
            <p className="text-muted-foreground mb-2">You may not use NoFikar to:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Track individuals without their consent</li>
              <li>Stalk, harass, or threaten others</li>
              <li>Violate any laws or regulations</li>
              <li>Interfere with service security or integrity</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Emergency Features</h2>
            <p className="text-muted-foreground">
              SOS and emergency features are provided as-is. NoFikar is not a substitute for emergency services. In case of emergency, always call local emergency services (911, etc.).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Limitation of Liability</h2>
            <p className="text-muted-foreground">
              NoFikar is provided "as is" without warranties. We are not liable for inaccurate location data, service interruptions, or damages arising from use of the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Account Termination</h2>
            <p className="text-muted-foreground">
              We reserve the right to suspend or terminate accounts that violate these terms. You may delete your account at any time from Settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Changes to Terms</h2>
            <p className="text-muted-foreground">
              We may update these terms. Continued use after changes constitutes acceptance of new terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Contact</h2>
            <p className="text-muted-foreground">
              Questions about these terms? Contact us at: legal@nofikar.com
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
