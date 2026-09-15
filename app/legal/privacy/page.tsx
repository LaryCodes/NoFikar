import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-6 py-12">
        <Link href="/app/settings">
          <Button variant="ghost" size="sm" className="mb-6 gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>

        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6 text-sm">
          <section>
            <h2 className="text-xl font-semibold mb-3">Introduction</h2>
            <p className="text-muted-foreground">
              NoFikar ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our family safety application.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Information We Collect</h2>
            <h3 className="text-lg font-medium mb-2">Location Data</h3>
            <p className="text-muted-foreground mb-3">
              We collect real-time GPS location data only when you explicitly enable location sharing. This includes:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Latitude and longitude coordinates</li>
              <li>Speed and direction of movement</li>
              <li>Activity status (stationary, walking, driving)</li>
              <li>GPS accuracy information</li>
            </ul>

            <h3 className="text-lg font-medium mb-2 mt-4">Account Information</h3>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Email address</li>
              <li>Name</li>
              <li>Profile picture (optional)</li>
            </ul>

            <h3 className="text-lg font-medium mb-2 mt-4">Device Information</h3>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Battery level</li>
              <li>Device type and operating system</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Share your location with family members you've chosen</li>
              <li>Send alerts for safe zone entries and exits</li>
              <li>Detect and notify about activities (driving, walking)</li>
              <li>Respond to emergency SOS signals</li>
              <li>Improve our services</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Your Control & Rights</h2>
            <p className="text-muted-foreground mb-2">You have the right to:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Enable or disable location sharing at any time</li>
              <li>Leave family circles</li>
              <li>Delete your account and all associated data</li>
              <li>Access your data</li>
              <li>Request data corrections</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Data Sharing</h2>
            <p className="text-muted-foreground">
              Your location data is only shared with members of your family circle. We do not sell your personal information to third parties. We may share data with service providers who help us operate our service (e.g., cloud hosting).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Data Retention</h2>
            <p className="text-muted-foreground">
              Location history is retained for 7 days. Account information is retained until you delete your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Security</h2>
            <p className="text-muted-foreground">
              We use industry-standard security measures including encryption in transit and at rest, secure authentication, and regular security audits.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Contact Us</h2>
            <p className="text-muted-foreground">
              For privacy concerns or questions, contact us at: privacy@nofikar.com
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
