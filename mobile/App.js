import { useCallback, useState } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  ActivityIndicator,
  Button,
  Card,
  Checkbox,
  Chip,
  Divider,
  MD3DarkTheme,
  PaperProvider,
  SegmentedButtons,
  Snackbar,
  Text,
  TextInput,
} from "react-native-paper";
import { DarkTheme as NavigationDarkTheme, NavigationContainer, useFocusEffect } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api, uploadImage } from "./src/services/api";

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: "#46baf3",
    secondary: "#43d2aa",
    background: "#08111e",
    surface: "#111e2e",
    surfaceVariant: "#1a2a3d",
    onSurface: "#e5edf6",
    outline: "#304359",
    error: "#ff7482",
  },
};
const navigationTheme = {
  ...NavigationDarkTheme,
  colors: {
    ...NavigationDarkTheme.colors,
    primary: theme.colors.primary,
    background: theme.colors.background,
    card: theme.colors.surface,
    text: theme.colors.onSurface,
    border: theme.colors.outline,
    notification: theme.colors.error,
  },
};

function useNotice() {
  const [notice, setNotice] = useState("");
  return {
    notice,
    showNotice: setNotice,
    dismissNotice: () => setNotice(""),
    snackbar: <Snackbar visible={Boolean(notice)} onDismiss={() => setNotice("")} duration={3500}>{notice}</Snackbar>,
  };
}

function Screen({ children, style }) {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.screen, style]}>{children}</ScrollView>;
}

function Header({ eyebrow, title, description }) {
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text variant="headlineSmall" style={styles.title}>{title}</Text>
      {description ? <Text style={styles.muted}>{description}</Text> : null}
    </View>
  );
}

function Panel({ title, children, trailing }) {
  return (
    <Card style={styles.panel} mode="contained">
      {title ? <Card.Title title={title} titleVariant="titleMedium" right={trailing} /> : null}
      <Card.Content>{children}</Card.Content>
    </Card>
  );
}

function Field({ label, value, onChangeText, ...props }) {
  return <TextInput mode="outlined" label={label} value={value} onChangeText={onChangeText} style={styles.field} {...props} />;
}

function CheckRow({ label, value, onChange }) {
  return (
    <View style={styles.checkRow}>
      <Checkbox status={value ? "checked" : "unchecked"} onPress={() => onChange(!value)} />
      <Text onPress={() => onChange(!value)} style={styles.checkText}>{label}</Text>
    </View>
  );
}

function Result({ data, title = "Assessment" }) {
  if (!data) return null;
  const label = data.classification || data.verification || "Result";
  const level = label.toLowerCase();
  const color = level.includes("high") || level.includes("mismatch") || level.includes("not verified") ? "#ff7482" : level.includes("medium") || level.includes("pending") || level.includes("suspicious") ? "#f5c45d" : "#51d5a5";
  const reasons = data.reasons || [];
  return (
    <Panel title={title}>
      <View style={[styles.resultBanner, { borderColor: `${color}66` }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.resultLabel, { color }]}>DEMO RESULT</Text>
          <Text variant="titleMedium" style={styles.resultTitle}>{label}</Text>
        </View>
        {data.risk_score !== undefined ? <Text style={[styles.score, { color }]}>{data.risk_score}<Text style={styles.scoreOf}>/100</Text></Text> : null}
      </View>
      {reasons.map((item, index) => <Text key={`${item}-${index}`} style={styles.bullet}>•  {item}</Text>)}
      {(data.recommendations || []).map((item, index) => <Text key={`rec-${index}`} style={styles.bullet}>›  {item}</Text>)}
      {data.action ? <Text style={styles.bullet}>›  {data.action}</Text> : null}
      {data.urls?.map((url) => <Chip key={url} style={styles.urlChip} textStyle={styles.chipText}>{url}</Chip>)}
      {data.notice ? <Text style={styles.footnote}>{data.notice}</Text> : null}
    </Panel>
  );
}

function ErrorText({ children }) {
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

function LoadingButton({ loading, onPress, children, mode = "contained", ...props }) {
  return <Button mode={mode} onPress={onPress} loading={loading} disabled={loading || props.disabled} style={styles.button} contentStyle={styles.buttonContent} {...props}>{children}</Button>;
}

function Authentication({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("customer");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setLoading(true);
    setError("");
    try {
      if (mode === "register") await api.post("/auth/register", { name, email, password });
      const response = await api.post("/auth/login", { email, password });
      onAuthenticated({ ...response.data.user, role });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={styles.authScreen}>
      <View style={styles.brandMark}><MaterialCommunityIcons name="shield-check" size={30} color="#6bd3ff" /></View>
      <Text style={styles.brand}>PayShield <Text style={{ color: "#47b9f4" }}>AI</Text></Text>
      <Text style={styles.authSubtitle}>YOUR DIGITAL PAYMENT GUARDIAN</Text>
      <Panel title={mode === "login" ? "Welcome back" : "Create demo account"}>
        <Text style={styles.muted}>Select a workspace role for this device.</Text>
        <SegmentedButtons value={role} onValueChange={setRole} buttons={[{ value: "customer", label: "Customer" }, { value: "merchant", label: "Merchant" }]} style={styles.segment} />
        {mode === "register" ? <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" /> : null}
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Password (8+ characters)" value={password} onChangeText={setPassword} secureTextEntry />
        <ErrorText>{error}</ErrorText>
        <LoadingButton loading={loading} onPress={submit} disabled={!email || password.length < 8 || (mode === "register" && name.length < 2)}>
          {mode === "login" ? "Sign in" : "Create account"}
        </LoadingButton>
        <Button mode="text" onPress={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "New here? Create an account" : "Already registered? Sign in"}
        </Button>
        <Text style={styles.footnote}>Prototype authentication only. Role selection is local to this session and is not stored by the backend.</Text>
      </Panel>
      <SafetyNote />
    </Screen>
  );
}

function Overview({ user, navigation }) {
  const [data, setData] = useState(null);
  const [merchantData, setMerchantData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const analyticsRequest = api.get("/analytics/dashboard");
      const merchantRequest = user.role === "merchant" ? api.get("/merchant/dashboard") : Promise.resolve(null);
      const [analytics, merchant] = await Promise.all([analyticsRequest, merchantRequest]);
      setData(analytics.data);
      setMerchantData(merchant?.data || null);
      setError("");
    }
    catch (err) { setError(err.message); }
  }, [user.role]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const stats = user.role === "merchant" ? [
    ["Payment records", merchantData?.total_transactions ?? "—", "receipt-text-outline"],
    ["Verified amount", merchantData?.verified_amount !== undefined ? `₹${Number(merchantData.verified_amount).toLocaleString("en-IN")}` : "—", "shield-check-outline"],
    ["Pending requests", merchantData?.pending_payments ?? "—", "timer-sand"],
    ["Unverified claims", merchantData?.unverified_claims ?? "—", "alert-outline"],
  ] : [
    ["Messages checked", data?.messages_analyzed ?? "—", "message-text-outline"],
    ["Suspicious messages", data?.suspicious_messages ?? "—", "alert-outline"],
    ["Transactions checked", data?.transactions_analyzed ?? "—", "bank-transfer"],
    ["High-risk alerts", data?.high_risk_alerts ?? "—", "shield-alert-outline"],
  ];

  return (
    <Screen>
      <Header eyebrow={`PAYSHIELD AI  /  ${user.role.toUpperCase()}`} title={`Hello, ${user.name?.split(" ")[0] || "there"}`} description="Your digital payment safety overview." />
      <View style={styles.hero}>
        <MaterialCommunityIcons name="shield-check" size={35} color="#63d2ff" />
        <Text variant="titleLarge" style={styles.heroTitle}>Confidence in every payment.</Text>
        <Text style={styles.muted}>Check suspicious messages, review transfer context, and verify payment claims against demo records.</Text>
      </View>
      <ErrorText>{error}</ErrorText>
      <View style={styles.statGrid}>{stats.map(([label, value, icon]) => (
        <Card key={label} style={styles.statCard} mode="contained"><Card.Content>
          <MaterialCommunityIcons name={icon} size={19} color="#64c8f7" />
          <Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text>
        </Card.Content></Card>
      ))}</View>
      <Panel title="Safety checks">
        <ActionRow icon="message-alert-outline" title="Scan a message" detail="Check for phishing signs" onPress={() => navigation.navigate("Messages")} />
        <Divider />
        <ActionRow icon="bank-transfer" title="Assess a transfer" detail="Consider transaction context" onPress={() => navigation.navigate("Transaction")} />
        <Divider />
        <ActionRow icon="image-search-outline" title="Verify a payment" detail="Match claims to demo records" onPress={() => navigation.navigate("Payment")} />
      </Panel>
      <SafetyNote />
    </Screen>
  );
}

function ActionRow({ icon, title, detail, onPress }) {
  return (
    <Button mode="text" icon={icon} contentStyle={styles.actionRow} onPress={onPress}>
      <View style={styles.actionText}><Text style={styles.actionTitle}>{title}</Text><Text style={styles.mutedSmall}>{detail}</Text></View>
    </Button>
  );
}

function MessageScreen() {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const { notice, showNotice, snackbar } = useNotice();
  async function analyze() {
    setLoading(true); setResult(null);
    try { setResult((await api.post("/messages/analyze", { message })).data); }
    catch (err) { showNotice(err.message); }
    finally { setLoading(false); }
  }
  const sample = () => setMessage("Congratulations! You won ₹50,000. Click http://bit.ly/claim-prize and enter your bank details to receive your reward.");
  return (
    <Screen>
      <Header eyebrow="COMMUNICATION SAFETY" title="Message safety" description="Paste a text message to check for suspicious links and language." />
      <Panel title="Analyze a message">
        <Field label="SMS or chat message" value={message} onChangeText={setMessage} multiline numberOfLines={6} maxLength={5000} style={styles.multiline} />
        <Text style={styles.mutedSmall}>{message.length}/5000 characters</Text>
        <Button mode="text" onPress={sample} compact>Load suspicious sample</Button>
        <LoadingButton loading={loading} onPress={analyze} disabled={message.trim().length < 3}>Analyze message</LoadingButton>
      </Panel>
      <Result data={result} />
      <Text style={styles.footnote}>Avoid entering real private messages or sensitive personal information in this demo.</Text>
      <View>{snackbar}</View>
    </Screen>
  );
}

function TransactionScreen() {
  const [form, setForm] = useState({ sender_id: "customer-104", receiver_upi: "cornerstore@upi", amount: "850", recent_transactions: "2", average_amount: "600", is_receiver_new: false, unusual_time: false, receiver_previous_count: "4", device_anomaly: false, receiver_verified: true });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const { snackbar, showNotice } = useNotice();
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function assess() {
    setLoading(true); setResult(null);
    try {
      const payload = { ...form, amount: Number(form.amount), recent_transactions: Number(form.recent_transactions), average_amount: Number(form.average_amount), receiver_previous_count: Number(form.receiver_previous_count) };
      setResult((await api.post("/transactions/analyze", payload)).data);
    } catch (err) { showNotice(err.message); }
    finally { setLoading(false); }
  }
  return (
    <Screen>
      <Header eyebrow="BEFORE YOU PAY" title="Transaction safety" description="An unusual payment is not automatically fraud. Consider its context." />
      <Panel title="Transaction details">
        <Field label="Sender ID" value={form.sender_id} onChangeText={(v) => update("sender_id", v)} />
        <Field label="Receiver UPI ID" value={form.receiver_upi} onChangeText={(v) => update("receiver_upi", v)} autoCapitalize="none" />
        <Field label="Amount (INR)" value={form.amount} onChangeText={(v) => update("amount", v)} keyboardType="decimal-pad" />
        <Field label="Recent transaction count" value={form.recent_transactions} onChangeText={(v) => update("recent_transactions", v)} keyboardType="number-pad" />
        <Field label="Historical average amount" value={form.average_amount} onChangeText={(v) => update("average_amount", v)} keyboardType="decimal-pad" />
        <Field label="Previous payments to receiver" value={form.receiver_previous_count} onChangeText={(v) => update("receiver_previous_count", v)} keyboardType="number-pad" />
        <CheckRow label="New receiver" value={form.is_receiver_new} onChange={(v) => update("is_receiver_new", v)} />
        <CheckRow label="Unusual transaction time" value={form.unusual_time} onChange={(v) => update("unusual_time", v)} />
        <CheckRow label="Device or session anomaly" value={form.device_anomaly} onChange={(v) => update("device_anomaly", v)} />
        <CheckRow label="Receiver marked verified (demo)" value={form.receiver_verified} onChange={(v) => update("receiver_verified", v)} />
        <LoadingButton loading={loading} onPress={assess} disabled={!form.sender_id || !form.receiver_upi || Number(form.amount) <= 0}>Assess transaction</LoadingButton>
      </Panel>
      <Result data={result} />
      <View>{snackbar}</View>
    </Screen>
  );
}

function PaymentScreen() {
  const [form, setForm] = useState({ reference: "PSH-DEMO-1001", amount: "1250", receiver_upi: "cornerstore@upi" });
  const [result, setResult] = useState(null);
  const [imageResult, setImageResult] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { snackbar, showNotice } = useNotice();
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function verify() {
    setLoading(true); setResult(null);
    try {
      setResult((await api.post("/payments/verify", { ...form, amount: Number(form.amount) })).data);
    } catch (err) { showNotice(err.message); }
    finally { setLoading(false); }
  }

  async function selectImage(useCamera) {
    try {
      const permission = useCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showNotice("Allow camera or photo access to choose a payment screenshot.");
        return;
      }
      const picker = useCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const selection = await picker({ mediaTypes: ["images"], allowsEditing: false, quality: 0.8 });
      if (selection.canceled || !selection.assets?.[0]) return;
      setUploading(true);
      setSelectedImage(selection.assets[0]);
      setImageResult((await uploadImage(selection.assets[0])).data);
      showNotice("Image checked. OCR is only supporting evidence.");
    } catch (err) { showNotice(err.message); }
    finally { setUploading(false); }
  }

  function useExtracted() {
    const extracted = imageResult?.extracted;
    if (!extracted) return;
    setForm((current) => ({
      reference: extracted.reference || current.reference,
      amount: extracted.amount ? String(extracted.amount) : current.amount,
      receiver_upi: extracted.receiver_upi || current.receiver_upi,
    }));
    showNotice("Extracted fields copied. Verify them against a demo record.");
  }

  return (
    <Screen>
      <Header eyebrow="MERCHANT PROTECTION" title="Payment verification" description="Match visible payment details to simulated records. A screenshot is not proof." />
      <Panel title="Check a payment claim">
        <Field label="Transaction reference / UTR" value={form.reference} onChangeText={(v) => update("reference", v)} autoCapitalize="characters" />
        <Field label="Amount (INR)" value={form.amount} onChangeText={(v) => update("amount", v)} keyboardType="decimal-pad" />
        <Field label="Receiver UPI ID" value={form.receiver_upi} onChangeText={(v) => update("receiver_upi", v)} autoCapitalize="none" />
        <LoadingButton loading={loading} onPress={verify}>Match against demo records</LoadingButton>
      </Panel>
      <Result data={result} title="Verification result" />
      <Panel title="Screenshot details (optional)">
        <Text style={styles.muted}>OCR may be unavailable or incorrect. It cannot establish that funds arrived.</Text>
        <View style={styles.buttonRow}>
          <Button mode="outlined" icon="camera-outline" onPress={() => selectImage(true)} disabled={uploading}>Take photo</Button>
          <Button mode="outlined" icon="image-outline" onPress={() => selectImage(false)} disabled={uploading}>Choose image</Button>
        </View>
        {selectedImage ? <Image source={{ uri: selectedImage.uri }} resizeMode="contain" style={styles.screenshotPreview} /> : null}
        {uploading ? <ActivityIndicator style={styles.loader} /> : null}
        {imageResult ? <>
          <Text style={styles.bullet}>{imageResult.notice}</Text>
          {imageResult.extracted ? <Text selectable style={styles.extracted}>{JSON.stringify(imageResult.extracted, null, 2)}</Text> : null}
          {imageResult.extracted ? <Button mode="text" onPress={useExtracted}>Copy extracted fields to verifier</Button> : null}
        </> : null}
      </Panel>
      <Panel title="Demo records">
        {[
          ["PSH-DEMO-1001", "₹1,250", "Successful"],
          ["PSH-DEMO-1002", "₹499", "Pending"],
          ["PSH-DEMO-1003", "₹2,200", "Failed"],
        ].map(([reference, amount, status]) => (
          <Button key={reference} mode="text" onPress={() => { setForm({ reference, amount: amount.replace(/[₹,]/g, ""), receiver_upi: "cornerstore@upi" }); setResult(null); }}>
            {reference}  ·  {amount}  ·  {status}
          </Button>
        ))}
      </Panel>
      <SafetyNote />
      <View>{snackbar}</View>
    </Screen>
  );
}

function MerchantScreen({ navigation, onSignOut }) {
  const [data, setData] = useState(null);
  const [merchant, setMerchant] = useState("Corner Store");
  const [amount, setAmount] = useState("450");
  const [upi, setUpi] = useState("cornerstore@upi");
  const [created, setCreated] = useState(null);
  const [loading, setLoading] = useState(false);
  const { snackbar, showNotice } = useNotice();
  const load = useCallback(async () => {
    try { setData((await api.get("/merchant/dashboard")).data); }
    catch (err) { showNotice(err.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function createRequest() {
    setLoading(true);
    try {
      const response = await api.post("/merchant/create-request", { merchant, amount: Number(amount), receiver_upi: upi });
      setCreated(response.data);
      await load();
    } catch (err) { showNotice(err.message); }
    finally { setLoading(false); }
  }

  return (
    <Screen>
      <Header eyebrow="SHOPKEEPER WORKSPACE" title="Merchant tools" description="Create requests and review local simulated records." />
      <View style={styles.statGrid}>
        <MiniStat label="Payment records" value={data?.total_transactions ?? "—"} />
        <MiniStat label="Pending requests" value={data?.pending_payments ?? "—"} />
        <MiniStat label="Unverified claims" value={data?.unverified_claims ?? "—"} />
        <MiniStat label="Suspicious attempts" value={data?.suspicious_attempts ?? "—"} />
      </View>
      <Panel title="Create a demo request">
        <Field label="Shop name" value={merchant} onChangeText={setMerchant} />
        <Field label="Expected amount (INR)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Field label="Registered UPI ID" value={upi} onChangeText={setUpi} autoCapitalize="none" />
        <LoadingButton loading={loading} onPress={createRequest} disabled={!merchant || !upi || Number(amount) <= 0}>Generate request</LoadingButton>
        {created ? <Text style={styles.successText}>Order {created.order_id} created · simulated only</Text> : null}
      </Panel>
      <Panel title="Recent payment requests">
        {data?.requests?.length ? data.requests.map((item) => (
          <View key={item.order_id} style={styles.historyRow}>
            <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.order_id}</Text><Text style={styles.mutedSmall}>{item.merchant} · ₹{item.amount}</Text></View>
            <Chip compact>{item.status}</Chip>
          </View>
        )) : <Text style={styles.muted}>No payment requests yet.</Text>}
      </Panel>
      <Panel title="Simulated payment records">
        {data?.records?.length ? data.records.map((item) => (
          <View key={item.reference} style={styles.historyRow}>
            <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.reference}</Text><Text style={styles.mutedSmall}>{item.receiver_upi} · ₹{item.amount}</Text></View>
            <Chip compact>{item.status}</Chip>
          </View>
        )) : <Text style={styles.muted}>No payment records available.</Text>}
      </Panel>
      <Panel title="More">
        <Button mode="text" icon="file-document-outline" onPress={() => navigation.navigate("Reports")}>Open fraud reports</Button>
        <Button mode="text" icon="logout" onPress={onSignOut}>Sign out</Button>
      </Panel>
      <SafetyNote />
      <View>{snackbar}</View>
    </Screen>
  );
}

function MiniStat({ label, value }) {
  return <Card style={styles.miniStat} mode="contained"><Card.Content><Text style={styles.miniValue}>{value}</Text><Text style={styles.mutedSmall}>{label}</Text></Card.Content></Card>;
}

function ReportsScreen() {
  const [category, setCategory] = useState("Suspicious message");
  const [description, setDescription] = useState("");
  const [risk, setRisk] = useState("70");
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { snackbar, showNotice } = useNotice();
  const load = useCallback(async () => {
    try { setReports((await api.get("/reports")).data); }
    catch (err) { showNotice(err.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function create() {
    setLoading(true);
    try {
      await api.post("/reports/create", { category, description, risk_score: Number(risk) });
      setDescription("");
      await load();
      showNotice("Report saved in the local demo database.");
    } catch (err) { showNotice(err.message); }
    finally { setLoading(false); }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const file = await FileSystem.downloadAsync(
        `${api.defaults.baseURL}/reports/export`,
        `${FileSystem.cacheDirectory}payshield-reports.csv`,
      );
      if (!(await Sharing.isAvailableAsync())) {
        showNotice(`CSV saved at ${file.uri}, but sharing is unavailable on this device.`);
        return;
      }
      await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "Export PayShield reports" });
    } catch (err) {
      showNotice(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen>
      <Header eyebrow="INCIDENT LOG" title="Fraud reports" description="Log suspicious activity without including sensitive information." />
      <Panel title="Log an incident">
        <SegmentedButtons value={category} onValueChange={setCategory} buttons={[
          { value: "Suspicious message", label: "Message" },
          { value: "Payment screenshot claim", label: "Payment" },
        ]} style={styles.segment} />
        <Field label="Description" value={description} onChangeText={setDescription} multiline numberOfLines={4} style={styles.multiline} />
        <Field label="Risk indicator (0–100)" value={risk} onChangeText={setRisk} keyboardType="number-pad" />
        <LoadingButton loading={loading} onPress={create} disabled={description.trim().length < 3}>Save report</LoadingButton>
      </Panel>
      <Panel title="Recent reports">
        <LoadingButton mode="outlined" loading={exporting} onPress={exportCsv}>Export reports as CSV</LoadingButton>
        {reports.length ? reports.map((item) => (
          <View key={item.id} style={styles.reportItem}>
            <View style={styles.historyRow}>
              <Text style={styles.rowTitle}>{item.category}</Text>
              <Chip compact>{item.risk_score}/100</Chip>
            </View>
            <Text style={styles.muted}>{item.description}</Text>
            <Text style={styles.mutedSmall}>{new Date(item.created_at).toLocaleString()} · {item.status}</Text>
          </View>
        )) : <Text style={styles.muted}>No incidents recorded yet.</Text>}
      </Panel>
      <View>{snackbar}</View>
    </Screen>
  );
}

function SafetyNote() {
  return (
    <View style={styles.safetyNote}>
      <MaterialCommunityIcons name="shield-alert-outline" size={18} color="#f0c45f" />
      <Text style={styles.safetyText}>Demo only. Never share OTPs or UPI PINs. Confirm incoming funds in your authorized payment app; screenshots are not proof.</Text>
    </View>
  );
}

function MainTabs({ user, onSignOut }) {
  return (
    <Tabs.Navigator screenOptions={({ route }) => ({
      headerShown: false,
      tabBarStyle: styles.tabBar,
      tabBarActiveTintColor: "#63c9f8",
      tabBarInactiveTintColor: "#75869a",
      tabBarLabelStyle: styles.tabLabel,
      tabBarIcon: ({ color, size }) => {
        const icons = { Home: "view-dashboard-outline", Messages: "message-alert-outline", Transaction: "bank-transfer", Payment: "image-search-outline", Merchant: "storefront-outline" };
        return <MaterialCommunityIcons name={icons[route.name]} size={size} color={color} />;
      },
    })}>
      <Tabs.Screen name="Home" options={{ title: "Home" }}>{(props) => <Overview {...props} user={user} />}</Tabs.Screen>
      <Tabs.Screen name="Messages" component={MessageScreen} options={{ title: "Messages" }} />
      <Tabs.Screen name="Transaction" component={TransactionScreen} options={{ title: "Transfer" }} />
      <Tabs.Screen name="Payment" component={PaymentScreen} options={{ title: "Verify" }} />
      <Tabs.Screen name="Merchant" options={{ title: user.role === "merchant" ? "Shop" : "More" }}>{(props) => <MerchantScreen {...props} onSignOut={onSignOut} />}</Tabs.Screen>
    </Tabs.Navigator>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  return (
    <PaperProvider theme={theme}>
      <StatusBar style="light" />
      <NavigationContainer theme={navigationTheme}>
        <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: "#0a1422" }, headerTintColor: "#e6eef7", contentStyle: { backgroundColor: "#08111e" } }}>
          {user ? <>
            <Stack.Screen name="Dashboard" options={{ headerShown: false }}>
              {(props) => <MainTabs {...props} user={user} onSignOut={() => setUser(null)} />}
            </Stack.Screen>
            <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: "Fraud reports" }} />
          </> : <Stack.Screen name="Sign in" options={{ headerShown: false }}>
            {() => <Authentication onAuthenticated={setUser} />}
          </Stack.Screen>}
        </Stack.Navigator>
      </NavigationContainer>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 18, paddingBottom: 36, gap: 14 },
  authScreen: { flexGrow: 1, justifyContent: "center", paddingTop: 36 },
  header: { gap: 6, marginBottom: 2 },
  eyebrow: { color: "#74b7d6", fontSize: 10, fontWeight: "700", letterSpacing: 1.5 },
  title: { color: "#edf5fc", fontWeight: "700", marginTop: 2 },
  muted: { color: "#9aabbe", lineHeight: 20, fontSize: 13 },
  mutedSmall: { color: "#8294aa", fontSize: 11 },
  panel: { backgroundColor: "#111e2e", borderColor: "#223349", borderWidth: 1, borderRadius: 12 },
  field: { marginBottom: 10, backgroundColor: "#0b1624" },
  button: { marginTop: 12, borderRadius: 8 },
  buttonContent: { minHeight: 44 },
  multiline: { minHeight: 125 },
  hero: { padding: 18, borderRadius: 14, borderColor: "#24475b", borderWidth: 1, backgroundColor: "#10283b", gap: 10 },
  heroTitle: { color: "#eef8ff", fontWeight: "700" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: { flexGrow: 1, flexBasis: "46%", backgroundColor: "#111e2e", borderWidth: 1, borderColor: "#223349", borderRadius: 10 },
  statValue: { fontSize: 23, color: "#e8f2fb", fontWeight: "700", marginTop: 7 },
  statLabel: { fontSize: 11, color: "#8fa1b5", marginTop: 2 },
  actionRow: { flexDirection: "row", justifyContent: "flex-start", minHeight: 58 },
  actionText: { marginLeft: 8 },
  actionTitle: { color: "#dce9f5", fontSize: 13, fontWeight: "600" },
  checkRow: { flexDirection: "row", alignItems: "center", marginLeft: -8, marginVertical: -3 },
  checkText: { color: "#b8c6d6", fontSize: 13 },
  resultBanner: { minHeight: 66, borderRadius: 10, borderWidth: 1, backgroundColor: "#0d1927", padding: 13, flexDirection: "row", alignItems: "center", marginBottom: 10 },
  resultLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  resultTitle: { color: "#edf4fb", fontWeight: "600", marginTop: 3 },
  score: { fontSize: 26, fontWeight: "700" },
  scoreOf: { color: "#8193a7", fontSize: 11, fontWeight: "400" },
  bullet: { color: "#b0bfce", fontSize: 12, lineHeight: 19, marginVertical: 3 },
  footnote: { color: "#7f92a7", fontSize: 10, lineHeight: 16, marginTop: 8 },
  urlChip: { alignSelf: "flex-start", marginTop: 7, backgroundColor: "#202d3d" },
  chipText: { color: "#add9eb", fontSize: 10 },
  error: { color: "#ff8791", marginVertical: 6, fontSize: 12 },
  brandMark: { alignSelf: "center", width: 58, height: 58, borderRadius: 18, backgroundColor: "#15334a", alignItems: "center", justifyContent: "center", marginBottom: 14, borderColor: "#2b607b", borderWidth: 1 },
  brand: { textAlign: "center", color: "#eff7ff", fontWeight: "800", fontSize: 27 },
  authSubtitle: { textAlign: "center", color: "#829bb0", fontSize: 9, letterSpacing: 1.8, marginBottom: 25, marginTop: 5 },
  segment: { marginVertical: 16 },
  result: { marginTop: 10 },
  safetyNote: { backgroundColor: "#282315", borderColor: "#514525", borderWidth: 1, borderRadius: 9, padding: 12, flexDirection: "row", gap: 9, alignItems: "flex-start" },
  safetyText: { color: "#cdbd85", flex: 1, fontSize: 10, lineHeight: 16 },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 13 },
  loader: { margin: 15 },
  extracted: { color: "#8fcbdb", backgroundColor: "#0a1522", padding: 10, borderRadius: 7, fontSize: 11, marginTop: 10 },
  screenshotPreview: { height: 190, marginTop: 12, borderRadius: 9, backgroundColor: "#09131f" },
  miniStat: { backgroundColor: "#111e2e", flexGrow: 1, flexBasis: "45%", borderWidth: 1, borderColor: "#223349" },
  miniValue: { color: "#e4f0fa", fontSize: 20, fontWeight: "700" },
  historyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9, gap: 8 },
  rowTitle: { color: "#d4e2ef", fontSize: 12, fontWeight: "600" },
  successText: { color: "#55d5a5", fontSize: 12, marginTop: 12 },
  reportItem: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#304056", paddingVertical: 8, gap: 5 },
  tabBar: { backgroundColor: "#0b1523", borderTopColor: "#1e2c3e", height: 62, paddingBottom: 5, paddingTop: 5 },
  tabLabel: { fontSize: 9 },
});
