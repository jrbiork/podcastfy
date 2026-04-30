import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Folder } from '../types';
import { Colors, Spacing, Radius, FontSize, FOLDER_ICONS, FOLDER_COLORS } from '../utils/theme';

interface Props {
  visible: boolean;
  folder?: Folder;
  onSave: (data: Pick<Folder, 'name' | 'color' | 'iconName'>) => void;
  onClose: () => void;
}

export function FolderModal({ visible, folder, onSave, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [iconName, setIconName] = useState<string>(FOLDER_ICONS[0]);
  const [color, setColor] = useState(FOLDER_COLORS[0]);

  useEffect(() => {
    if (folder) {
      setName(folder.name);
      setIconName(folder.iconName ?? FOLDER_ICONS[0]);
      setColor(folder.color);
    } else {
      setName('');
      setIconName(FOLDER_ICONS[0]);
      setColor(FOLDER_COLORS[0]);
    }
  }, [folder, visible]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({ name: trimmed, color, iconName });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />

        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={styles.handle} />

          <Text style={styles.title}>{folder ? 'Edit Folder' : 'New Folder'}</Text>

          <View style={styles.preview}>
            <View style={[styles.previewIcon, { backgroundColor: color + '22', borderColor: color + '55' }]}>
              <Ionicons name={iconName as any} size={36} color={color} />
            </View>
            <Text style={[styles.previewName, { color }]}>{name || 'Folder Name'}</Text>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Folder name"
            placeholderTextColor={Colors.textDim}
            value={name}
            onChangeText={setName}
            maxLength={30}
            autoFocus={!folder}
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />

          <Text style={styles.sectionLabel}>Color</Text>
          <View style={styles.colorRow}>
            {FOLDER_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotSelected]}
                onPress={() => setColor(c)}
                activeOpacity={0.8}
              />
            ))}
          </View>

          <Text style={styles.sectionLabel}>Icon</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.iconScroll}>
            <View style={styles.iconGrid}>
              {FOLDER_ICONS.map((icon) => (
                <TouchableOpacity
                  key={icon}
                  style={[
                    styles.iconBtn,
                    iconName === icon && { backgroundColor: color + '33', borderColor: color },
                  ]}
                  onPress={() => setIconName(icon)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={icon as any}
                    size={22}
                    color={iconName === icon ? color : Colors.textMuted}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, !name.trim() && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!name.trim()}
              activeOpacity={0.8}
            >
              <Text style={styles.saveText}>{folder ? 'Save' : 'Create'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderLight,
    alignSelf: 'center',
    marginBottom: Spacing.lg,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  preview: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  previewIcon: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewName: {
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: FontSize.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    marginBottom: Spacing.lg,
  },
  sectionLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    fontWeight: '600',
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  colorRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
    flexWrap: 'wrap',
  },
  colorDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorDotSelected: {
    borderColor: Colors.text,
    transform: [{ scale: 1.15 }],
  },
  iconScroll: {
    marginBottom: Spacing.lg,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: Spacing.sm,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  cancelText: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '700',
  },
});
