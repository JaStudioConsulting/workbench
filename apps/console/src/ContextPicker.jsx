import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.tsx";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./components/ui/command.tsx";
import { Button } from "./components/ui/button.tsx";
const contexts = ["Independent recruiting", "Lumentis", "Discount Tire · 3661896"];
export default function ContextPicker({ value, onChange }) { const [open, setOpen] = useState(false); return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger render={<Button variant="outline" className="w-full min-w-0 justify-between sm:w-auto sm:min-w-56" />}><span className="truncate">{value}</span><ChevronsUpDown data-icon="inline-end" /></PopoverTrigger><PopoverContent className="w-64 max-w-[calc(100vw-2rem)] p-0"><Command><CommandInput placeholder="Choose role or case" /><CommandList><CommandEmpty>No matching context.</CommandEmpty><CommandGroup>{contexts.map((item) => <CommandItem key={item} value={item} onSelect={() => { onChange(item); setOpen(false); }}>{item}{item === value && <Check className="ml-auto" />}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover>; }
