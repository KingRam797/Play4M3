// Play4M3 ghidra-headless skill: post-script that exports a normalized
// function list as JSON (format "p4m3-analysis/0").
//
// Runs inside the analysis worker (no network, resource caps). Its output is
// untrusted: names and strings come from the analyzed file. The host parses it
// with a strict Zod schema and caps every field again; the caps here only keep
// the file small. The script exports names, addresses, sizes, referenced
// strings and referenced globals. It never exports code bytes or decompiled
// output (brief section 2.2).
//
// Usage: -postScript P4m3ExportFunctions.java <output.json>
// @category Play4M3

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.DataType;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.Symbol;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public class P4m3ExportFunctions extends GhidraScript {
	private static final int MAX_FUNCTIONS = 5000;
	private static final int MAX_STRINGS_PER_FUNCTION = 32;
	private static final int MAX_STRING_CHARS = 512;
	private static final int MAX_GLOBALS_PER_FUNCTION = 32;
	private static final int MAX_NAME_CHARS = 256;

	@Override
	protected void run() throws Exception {
		String[] args = getScriptArgs();
		if (args.length != 1) {
			throw new IllegalArgumentException("expected one argument: output path");
		}
		StringBuilder out = new StringBuilder();
		out.append("{\"format\":\"p4m3-analysis/0\",\"program\":{");
		out.append("\"name\":").append(json(cap(currentProgram.getName(), MAX_NAME_CHARS)));
		out.append(",\"language\":").append(json(currentProgram.getLanguageID().getIdAsString()));
		out.append(",\"imageBase\":").append(json(hex(currentProgram.getImageBase())));
		out.append(",\"sha256\":").append(json(String.valueOf(currentProgram.getExecutableSHA256())));
		out.append("},\"functions\":[");

		int count = 0;
		boolean truncated = false;
		for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
			if (monitor.isCancelled()) {
				break;
			}
			if (f.isExternal() || f.isThunk()) {
				continue;
			}
			if (count == MAX_FUNCTIONS) {
				truncated = true;
				break;
			}
			if (count > 0) {
				out.append(',');
			}
			appendFunction(out, f);
			count++;
		}
		out.append("],\"truncated\":").append(truncated).append('}');

		File file = new File(args[0]);
		try (Writer w = new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8)) {
			w.write(out.toString());
		}
		println("p4m3: exported " + count + " functions");
	}

	private void appendFunction(StringBuilder out, Function f) {
		Set<String> strings = new LinkedHashSet<>();
		Map<Address, String> globals = new LinkedHashMap<>();
		InstructionIterator it = currentProgram.getListing().getInstructions(f.getBody(), true);
		while (it.hasNext()) {
			Instruction ins = it.next();
			for (Reference ref : ins.getReferencesFrom()) {
				Address to = ref.getToAddress();
				if (to == null || !to.isMemoryAddress()) {
					continue;
				}
				MemoryBlock block = getMemoryBlock(to);
				if (block == null || block.isExecute()) {
					continue;
				}
				Data d = getDataAt(to);
				if (d != null && d.hasStringValue()) {
					if (strings.size() < MAX_STRINGS_PER_FUNCTION) {
						Object v = d.getValue();
						if (v != null) {
							strings.add(cap(v.toString(), MAX_STRING_CHARS));
						}
					}
					continue;
				}
				if (globals.size() < MAX_GLOBALS_PER_FUNCTION && !globals.containsKey(to)) {
					globals.put(to, global(to, d));
				}
			}
		}

		out.append("{\"entry\":").append(json(hex(f.getEntryPoint())));
		out.append(",\"size\":").append(f.getBody().getNumAddresses());
		out.append(",\"name\":").append(json(cap(f.getName(), MAX_NAME_CHARS)));
		out.append(",\"strings\":[");
		int i = 0;
		for (String s : strings) {
			if (i++ > 0) {
				out.append(',');
			}
			out.append(json(s));
		}
		out.append("],\"globals\":[");
		i = 0;
		for (String g : globals.values()) {
			if (i++ > 0) {
				out.append(',');
			}
			out.append(g);
		}
		out.append("]}");
	}

	/** One referenced global: address, symbol name, data type, and the value for 4-byte float/int data. */
	private String global(Address to, Data d) {
		Symbol sym = getSymbolAt(to);
		String name = sym == null ? null : cap(sym.getName(), MAX_NAME_CHARS);
		String type = null;
		String value = "null";
		if (d != null) {
			DataType dt = d.getDataType();
			type = cap(dt.getName(), 64);
			try {
				if (dt.getLength() == 4 && (type.equals("float"))) {
					float v = getFloat(to);
					value = Float.isFinite(v) ? Float.toString(v) : "null";
				}
				else if (dt.getLength() == 4 && (type.equals("int") || type.equals("uint") || type.equals("dword"))) {
					value = Integer.toString(getInt(to));
				}
			}
			catch (Exception e) {
				value = "null";
			}
		}
		return "{\"address\":" + json(hex(to)) + ",\"name\":" + (name == null ? "null" : json(name)) +
			",\"type\":" + (type == null ? "null" : json(type)) + ",\"value\":" + value + "}";
	}

	private static String hex(Address a) {
		return "0x" + Long.toHexString(a.getOffset());
	}

	private static String cap(String s, int max) {
		if (s == null) {
			return "";
		}
		return s.length() <= max ? s : s.substring(0, max);
	}

	/** JSON string literal; everything outside printable ASCII is \\u-escaped. */
	private static String json(String s) {
		StringBuilder b = new StringBuilder(s.length() + 2);
		b.append('"');
		for (int i = 0; i < s.length(); i++) {
			char c = s.charAt(i);
			if (c == '"' || c == '\\') {
				b.append('\\').append(c);
			}
			else if (c < 0x20 || c > 0x7e) {
				b.append(String.format("\\u%04x", (int) c));
			}
			else {
				b.append(c);
			}
		}
		return b.append('"').toString();
	}
}
