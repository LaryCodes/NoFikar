import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function SafetyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-6 py-12">
        <Link href="/app/settings">
          <Button variant="ghost" size="sm" className="mb-6 gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>

        <h1 className="text-3xl font-bold mb-2">Safety Guidelines</h1>
        <p className="text-muted-foreground mb-8">Best practices for using NoFikar safely</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6 text-sm">
          <section>
            <h2 className="text-xl font-semibold mb-3">Consent is Essential</h2>
            <p className="text-muted-foreground mb-2">
              NoFikar is built on trust and transparency:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>All location sharing is voluntary</li>
              <li>Users can see when sharing is active</li>
              <li>Sharing can be stopped at any time</li>
              <li>Never pressure someone to share their location</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">For Parents & Guardians</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Explain why you want to use the app</li>
              <li>Respect your child's privacy</li>
              <li>Use location sharing as a safety tool, not surveillance</li>
              <li>Have open conversations about online safety</li>
              <li>Respect when they need privacy</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">For Teens & Young Adults</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>You control your location sharing</li>
              <li>It's okay to pause sharing when you need privacy</li>
              <li>Talk to family about boundaries</li>
              <li>Use the app as a safety tool when needed</li>
              <li>Report any misuse to us</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Emergency Features</h2>
            <p className="text-muted-foreground mb-2">
              Important information about SOS and emergency features:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>SOS alerts your family but is NOT a replacement for 911</li>
              <li>In real emergencies, always call emergency services first</li>
              <li>Emergency camera/audio requires explicit approval</li>
              <li>Emergency sessions automatically expire</li>
              <li>False alarms should be avoided</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Privacy Best Practices</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Only add trusted family members</li>
              <li>Keep your family code private</li>
              <li>Review family members regularly</li>
              <li>Use strong passwords</li>
              <li>Enable two-factor authentication when available</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Safe Zones</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Create safe zones for places like home and school</li>
              <li>Use appropriate radius sizes</li>
              <li>Enable alerts based on your needs</li>
              <li>Respect that alerts are informational, not controlling</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Reporting Abuse</h2>
            <p className="text-muted-foreground mb-2">
              If you believe NoFikar is being used inappropriately:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Leave the family circle immediately</li>
              <li>Report the abuse to us at: safety@nofikar.com</li>
              <li>Contact local authorities if needed</li>
              <li>We take all reports seriously</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Resources</h2>
            <p className="text-muted-foreground">
              If you're experiencing domestic abuse or need support:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground mt-2">
              <li>National Domestic Violence Hotline: 1-800-799-7233</li>
              <li>Crisis Text Line: Text HOME to 741741</li>
              <li>Childhelp National Child Abuse Hotline: 1-800-422-4453</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Contact Us</h2>
            <p className="text-muted-foreground">
              Safety concerns or questions: safety@nofikar.com
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
